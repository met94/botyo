import "reflect-metadata";
import 'source-map-support/register';
import { ApplicationConfiguration, AsyncResolvable, CommandErrorHandlerModule, Constructor, Module } from "botyo-api";
import BotyoBuilder from "./BotyoBuilder";
export default class Botyo {
    private readonly applicationConfigurationProvider;
    private readonly asyncResolvables;
    private readonly modules;
    private readonly commandErrorHandler;
    private readonly moduleConfigs;
    private applicationConfiguration;
    private applicationContainer;
    private stopListening;
    private taskScheduler;
    private running;
    private iocContainer;
    private logger;
    constructor(applicationConfigurationProvider: () => ApplicationConfiguration, asyncResolvables: Constructor<AsyncResolvable<any>>[], modules: Constructor<Module>[], commandErrorHandler: Constructor<CommandErrorHandlerModule>, moduleConfigs: Map<Constructor<Module>, object>);
    start(): Promise<void>;
    stop(): Promise<void>;
    private bindAsyncResolvables;
    private bindModuleConfigs;
    private bindModules;
    private attachFilterChainMessageListener;
    private invokeFunctionOnAllModules;
    private startTaskScheduler;
    static builder(): BotyoBuilder;
    private static printBanner;
}
