import {
    AbstractEmptyAsyncResolvable,
    ApplicationConfiguration,
    ChatApi,
    ChatThreadUtils,
    ConfigurationChatThreadsObject,
    ConfigurationParticipantsObject,
    Constants,
    FacebookId,
    Logger,
    UserIdSearchResult,
    UserInfoObject
} from "botyo-api";
import { inject, injectable } from "inversify";
import * as _ from "lodash";
import * as util from "util";

const REGEX_DIGITS = /^\d+$/;

@injectable()
export default class AsyncResolvableChatParticipantsResolver extends AbstractEmptyAsyncResolvable
{
    private readonly vanityNameToUserIdMap: Map<string, FacebookId> = new Map();

    constructor(@inject(ChatApi.SYMBOL) private readonly chatApi: ChatApi,
                @inject(ApplicationConfiguration.SYMBOL) private readonly applicationConfiguration: ApplicationConfiguration,
                @inject(Logger.SYMBOL) private readonly logger: Logger,
                @inject(ChatThreadUtils.SYMBOL) private readonly chatThreadUtils: ChatThreadUtils)
    {
        super();
    }

    async resolve(): Promise<void>
    {
        await this.resolveDeclaredVanityNamesToIds();
        await this.populateActualParticipants();
        await this.populateParticipantsInfo();
    }

    async resolveDeclaredVanityNamesToIds()
    {
        const vanityToGetUserIdPromiseMap = new Map<string, Promise<UserIdSearchResult[]>>();

        return this.chatThreadUtils.forEachParticipantInEachChatThread(async (chatThreadId,
                                                                              participantVanityOrId,
                                                                              participantObj,
                                                                              participantsObj) => {
            // if this looks like id, skip it
            if (REGEX_DIGITS.test(participantVanityOrId as string)) {
                return;
            }

            let userId = this.vanityNameToUserIdMap.get(participantVanityOrId as string);
            if (userId === undefined) {
                let getUserIdPromise = vanityToGetUserIdPromiseMap.get(participantVanityOrId as string);
                if (getUserIdPromise === undefined) {
                    getUserIdPromise = this.chatApi.getUserId(participantVanityOrId as string);
                    vanityToGetUserIdPromiseMap.set(participantVanityOrId as string, getUserIdPromise);
                }

                const results = (await getUserIdPromise).filter(r => r.type === "user");

                if (results.length === 0) {
                    this.logger.warn(`Could not find a user with vanity name '${participantVanityOrId}'. ` +
                        `Configuration for this user will not be applied.`);
                    return;
                }

                const theResult = results[0];

                if (results.length > 1) {
                    this.logger.warn(
                        `There are multiple users with vanity names similar to '${participantVanityOrId}'. ` +
                        `Botyo will assume the person you meant is '${theResult.profileUrl}'. ` +
                        `If this is incorrect please use the Facebook ID of the desired person. ` +
                        `Here are the search results for your convenience:\n%s`,
                        util.inspect(_.fromPairs(_.map(results, r => [r.userID, r.profileUrl])))
                    );
                }

                userId = theResult.userID;

                // cache it
                this.vanityNameToUserIdMap.set(participantVanityOrId as string, userId);
                this.logger.verbose(`${participantVanityOrId} -> ${userId}`);
            }

            // assign the same object to the new id property and keep the vanity property in order for the
            // configuration to stay in sync and for convenience
            participantsObj[userId] = participantsObj[participantVanityOrId];
        });
    }

    async populateActualParticipants()
    {
        if (!this.applicationConfiguration.hasProperty(Constants.CONFIG_KEY_CHAT_THREADS)) {
            this.applicationConfiguration.setProperty(Constants.CONFIG_KEY_CHAT_THREADS, {});
        }

        const chatThreadsObj =
            this.applicationConfiguration.getProperty(Constants.CONFIG_KEY_CHAT_THREADS) as ConfigurationChatThreadsObject;

        for (let chatThreadId of _.keys(chatThreadsObj)) {
            chatThreadsObj[chatThreadId] = chatThreadsObj[chatThreadId] || {};

            let threadInfo;
            try {
                threadInfo = await this.chatApi.getThreadInfo(chatThreadId);
            } catch (err) {
                this.logger.warn(
                    `Could not get info for chat thread '${chatThreadId}'. ` +
                    `Please make sure the current user (https://www.facebook.com/${this.chatApi.getCurrentUserId()}) ` +
                    `is a participant of that chat thread (https://m.me/${chatThreadId}).`, err
                );

                continue;
            }

            chatThreadsObj[chatThreadId].name = threadInfo.threadName || undefined;

            if (!_.has(chatThreadsObj[chatThreadId], Constants.CONFIG_KEY_PARTICIPANTS)) {
                _.set(chatThreadsObj[chatThreadId], Constants.CONFIG_KEY_PARTICIPANTS, {});
            }

            const participantsObj = _.get(chatThreadsObj[chatThreadId], Constants.CONFIG_KEY_PARTICIPANTS) as
                ConfigurationParticipantsObject;

            threadInfo.participantIDs.forEach(id => {
                if (participantsObj[id] === undefined) {
                    participantsObj[id] = {} as any;
                }
            });

            if (threadInfo.nicknames) {
                for (let [id, nickname] of _.toPairs(threadInfo.nicknames)) {
                    if (participantsObj[id]) {
                        participantsObj[id].nickname = nickname;
                    }
                }
            }
        }
    }

    async populateParticipantsInfo()
    {
        const idsSet: Set<string> = new Set();

        await this.chatThreadUtils.forEachParticipantInEachChatThread((chatThreadId, participantVanityOrId) => {
            if (!REGEX_DIGITS.test(participantVanityOrId as string)) {
                return;
            }

            idsSet.add(participantVanityOrId as string);
        });

        const userInfoResults = await this.chatApi.getUserInfo(Array.from(idsSet));

        return this.chatThreadUtils.forEachParticipantInEachChatThread((chatThreadId, participantId,
                                                                        participantObj, participantsObj) => {
            if (!REGEX_DIGITS.test(participantId as string)) {
                return;
            }

            const resultForUser = userInfoResults[participantId];
            if (resultForUser === undefined) {
                this.logger.info(`Could not get info for participant with id '${participantId}'`);
                return;
            }

            if (AsyncResolvableChatParticipantsResolver.isAccountInactive(resultForUser)) {
                this.logger.warn(`Account 'https://www.facebook.com/${participantId}' appears to be inactive`);
                delete participantsObj[participantId];
                return;
            }

            participantObj.name = resultForUser.name;
            participantObj.firstName = resultForUser.firstName;
            participantObj.id = participantId;
            participantObj.vanity = resultForUser.vanity;

            this.logger.verbose(`${participantId} -> vanity: '${participantObj.vanity}', name: '${participantObj.name}'`);

            // there are users with no vanity names, don't store these
            if (!_.isEmpty(resultForUser.vanity)) {
                participantsObj[resultForUser.vanity] = participantObj;
            }
        });
    }

    private static isAccountInactive(u: UserInfoObject): boolean
    {
        // most inactive accounts have this reserved name,
        // but some still have their real name, so additional checks need to be done
        if (u.name === "Facebook User" && u.firstName === "Facebook User") return true;

        // gender 7 apparently means account is inactive
        if (u.gender === 7) return true;

        // ALL inactive accounts are returned with no vanity AND no profileUrl
        if (!u.vanity && !u.profileUrl) return true;

        return false;
    }
}