import {IServerlessOptions, Serverless} from "./Serverless"
import { existsSync, mkdirSync, writeFileSync } from 'fs'

const GENERATE_JS_FILE_V3 = (lambdaEndpoint: string, lambdaFnName: string) => {
    const clauses = [
        '// AUTO GENERATED FILE PLEASE DO NOT MODIFY //',
        `const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');`,
        `const autoLocalAuthProxy = async (event, _context) => {
            const client = new LambdaClient({ endpoint: '${lambdaEndpoint}', credentials: { accessKeyId: '', secretAccessKey: '' }});
            const cmd = new InvokeCommand({
                FunctionName: '${lambdaFnName}',
                InvocationType: 'RequestResponse',
                Payload: JSON.stringify(event),
            });
            const res = await client.send(cmd)
            if (res.StatusCode === 200) {
                const buffer = Buffer.from(res.Payload, 'binary').toString('utf-8')
                return JSON.parse(buffer)
            }
            throw Error('Authorizer failed to validate request')
        };`,
        `module.exports = { autoLocalAuthProxy };`,
        '// AUTO GENERATED FILE PLEASE DO NOT MODIFY //',
    ]
    return clauses.join('\n')
}

const GENERATE_JS_FILE_V2 = (lambdaEndpoint: string, lambdaFnName: string) => {
    const clauses = [
        '// AUTO GENERATED FILE PLEASE DO NOT MODIFY //',
        `const AWS = require('aws-sdk');`,
        `const autoLocalAuthProxy = async (event, _context) => {
            const lambda = new AWS.Lambda({ endpoint: '${lambdaEndpoint}', credentials: { accessKeyId: '', secretAccessKey: '' }});
            const res = await lambda.invoke({
                FunctionName: '${lambdaFnName}',
                InvocationType: 'RequestResponse',
                Payload: JSON.stringify(event),
            }).promise();

console.log('RESP', res)
            if (res.StatusCode === 200) return JSON.parse(res.Payload)
            throw Error('Authorizer failed to validate request')
        };`,
        `module.exports = { autoLocalAuthProxy };`,
        '// AUTO GENERATED FILE PLEASE DO NOT MODIFY //',
    ]
    return clauses.join('\n')
}

// Configurations
interface LocalAuthConfigDisabled {
    mode: 'disabled' 
}
interface LocalAuthConfigHardcoded {
    mode: 'hardcoded'
    lambdaFilePath: string
}
interface LocalAuthConfigInjected {
    mode: 'inject' 
    lambdaEndpoint?: string
    lambdaAuthFnName?: string
    lambdaVersion: 'v2' | 'v3'
}
type LocalAuthConfig = LocalAuthConfigInjected | LocalAuthConfigDisabled | LocalAuthConfigHardcoded

export class AwsLocalAuthorizerPlugin {

    public hooks: { [key: string]: () => void };
    private config: LocalAuthConfig = { mode: 'disabled' }

    constructor(private serverless: Serverless, private options: IServerlessOptions) {
        if (this.serverless.service.provider.name !== "aws") {
            throw new this.serverless.classes.Error("aws-local-authorizers plugin only supports AWS as provider.");
        }

        this.serverless.configSchemaHandler.defineFunctionEventProperties('aws', 'http', {
            properties: {
                localAuthorizer: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        type: {
                            anyOf: ['token', 'cognito_user_pools', 'request', 'aws_iam'].map(
                              v => ({ type: 'string', regexp: new RegExp(`^${v}$`, 'i').toString() })
                            ),
                        },
                    }
                },
            },
        });

        this.hooks = {
            "initialize": this.onInitialized.bind(this),
            "before:offline:start:init": this.onOfflineStartInit.bind(this),
        };
    }

    private onInitialized() {
        const custom = this.serverless.service.custom;
        const mayBeConfig = (custom['serverless-offline'] || {})['serverless-offline-local-auth'] || custom['serverless-offline-local-auth'] || ''
        this.serverless.cli.log(`serverless-offline-local-auth [INITIALIZING] ${JSON.stringify(mayBeConfig)}.`, "serverless-offline-local-auth-plugin", { color: 'yellow' })
        this.config = this.parseConfiguration(mayBeConfig)
    }

    // Prepare the configurations
    private parseConfiguration(mayBeConfig: any): LocalAuthConfig {
        if (!mayBeConfig) {
            const authorizersFile = `${this.serverless.config.servicePath}/local-authorizers.js`;
            // local-authrizer file detected! enabled it.
            if (existsSync(authorizersFile)) {
                this.serverless.cli.log('local-authorizer proxy file exists!', "serverless-offline-local-auth-plugin")
                return {
                    mode: 'hardcoded',
                    lambdaFilePath: authorizersFile,
                };
            }
            return { mode: 'disabled' };
        } else if (typeof mayBeConfig === 'string') {
            if (/^disabled$/i.test(mayBeConfig)) {
                return { mode: 'disabled' };
            }
            return {
                mode: 'inject',
                lambdaAuthFnName: mayBeConfig,
                lambdaVersion: 'v3',
            }
        }
        return {
            mode: 'inject',
            lambdaVersion: 'v3',
            ...mayBeConfig,
        }
    }

    private onOfflineStartInit() {
        if (this.config.mode === 'disabled') {
            this.serverless.cli.log('serverless-offline-local-auth [DISABLED]', "serverless-offline-local-auth-plugin", { color: 'yellow' })
            return
        }
        this.serverless.cli.log(`serverless-offline-local-auth [ENABLED] >> ${JSON.stringify(this.config)}`, "serverless-offline-local-auth-plugin", { color: 'blue' })
        return this.applyLocalAuthorizers();
    }

    private async applyLocalAuthorizers(): Promise<any> {
        const localAuthorizers = this.appendLocalAuthorizers();
        if (!localAuthorizers || !Object.keys(localAuthorizers).length) {
            this.serverless.cli.log(`No local authorizers found.`, "serverless-offline-local-auth-plugin", { color: "yellow" });
            return;
        }

        const functions = this.serverless.service.functions;
        for (const functionName of Object.keys(functions)) {

            const functionDef = functions[functionName];
            if (functionDef && Array.isArray(functionDef.events)) {

                for (const event of functionDef.events) {
                    if (!event.http) {
                        continue;
                    }

                    const http = event.http as any;
                    let localAuthorizerDef = (http.authorizer && http.authorizer.localAuthorizer) ?  http.authorizer.localAuthorizer : http.localAuthorizer;

                    if (typeof localAuthorizerDef === "string") {
                        localAuthorizerDef = { name: localAuthorizerDef };
                    }

                    if (localAuthorizerDef) {
                        if (localAuthorizers[localAuthorizerDef.name]) {
                            const mockFnName = localAuthorizers[localAuthorizerDef.name];
                            http.authorizer = {
                                name: mockFnName,
                                type: localAuthorizerDef.type || "token",
                            };
                        } else {
                            const keys = Object.keys(localAuthorizers)
                            this.serverless.cli.log(`Invalid or unknown local authorizer '${JSON.stringify(localAuthorizerDef)}'. it seems there is only ${keys.length} authorizer(s) available ${keys.join(',')}`,
                                "serverless-offline-local-auth-plugin",
                                { color: "yellow" });
                        }
                    }
                }
            }
        }
    }

    /**
     * @returns list of configured local-authorizers
     */
    private appendLocalAuthorizers(): { [authorizerName: string]: string } {
        let authorizerSrcFilename = 'local-authorizers.js'
        let baseDir = ''
        // try to register all configurations
        let authorizers = {};
        try {
            if (this.config.mode === 'disabled') {
                throw new Error('WTF error')
            }
            if (this.config.mode === 'hardcoded') {
                authorizerSrcFilename = this.config.lambdaFilePath
            } else if (this.config.mode === 'inject') {
                // Generate the file!
                baseDir = '.serverless-offline-local-auth/'
                authorizerSrcFilename = `${this.serverless.config.servicePath}/${baseDir}local-authorizers.js`
                // make sure our sub-dir exists.
                const basePath = `${this.serverless.config.servicePath}/${baseDir}`;
                if (!existsSync(basePath)) {
                    mkdirSync(basePath, { recursive: true })
                }
                const content = this.config.lambdaVersion === 'v2'
                    ? GENERATE_JS_FILE_V2(this.config.lambdaEndpoint, this.config.lambdaAuthFnName)
                    : GENERATE_JS_FILE_V3(this.config.lambdaEndpoint, this.config.lambdaAuthFnName)
                writeFileSync(authorizerSrcFilename, content)
            }
            authorizers = require(authorizerSrcFilename);
        } catch (err) {
            console.error(err)
            this.serverless.cli.log(`Unable to load local authorizers from ${err && err.message || err}`, "serverless-offline-local-auth-plugin", { color: "red" });
            return null;
        }

        return Object.keys(authorizers).reduce((prev, authorizerName) => {
            const functionKey = `$_LOCAL_AUTH_${authorizerName}`;
            this.serverless.service.functions[functionKey] = {
                memorySize: 256,
                timeout: 30,
                handler: `${baseDir}local-authorizers.${authorizerName}`,
                events: [],
                name: `${this.serverless.service.service}-${this.options.stage}-${authorizerName}`,
                package:{
                    include:[[baseDir, authorizerSrcFilename].filter(Boolean).join('/')],
                    exclude:[]
                },
                runtime: "nodejs14.x"
            };
            prev[authorizerName] = functionKey;
            return prev;
        }, {});
    }
}
