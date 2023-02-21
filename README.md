# serverless-offline-auth-plugin

Forked from: [serverless-offline-auth-plugin](https://github.com/nlang/serverless-offline-local-authorizers-plugin).

[Serverless](http://www.serverless.com) plugin for adding authorizers when developing and testing
functions locally with [serverless-offline](https://github.com/dherault/serverless-offline).

[![Serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm](https://img.shields.io/npm/v/serverless-offline-local-auth-plugin.svg)](https://www.npmjs.com/package/serverless-offline-local-auth-plugin)
[![npm](https://img.shields.io/npm/l/serverless-offline-local-auth-plugin.svg)](https://www.npmjs.com/package/serverless-offline-local-auth-plugin)

This plugin allows you to add local authorizer functions to your serverless projects. These authorizers
are added dynamically in a way they can be called by `serverless-offline` but don't interfer with your
deployment and your shared authorizer functions. This helps when you have shared API Gateway authorizers
and developing and testing locally with `serverless-offline`.

> :warning: **If you are using this plugin and get schema validation errors**: Please check indentation of `localAuthorizer:` config property! See example below...

## Installation

Installing using npm:

```
npm i serverless-offline-local-auth-plugin --save-dev
```

## Before start

Add the plugin to the plugins sections in `serverless.yml` or your `serverless.ts` file.

```yaml
plugins:
  - serverless-offline-local-auth-plugin # <-- this should be loaded before serverless-offline as it uses offline's hook
  - serverless-offline
```

## Usage

With this plugin there are 2 ways to use this.

1. Provide the explicit authorization handler and specific the custom function name to the localAuthorizer node in your event. Or.
1. Use settings and let the plugin generate the code for you.

### Usage A: Classic

Use explicit authorization handler 

Please refers to original repo [usage](https://github.com/nlang/serverless-offline-local-authorizers-plugin#usage)

Explicitly define your authorizer functions in a file called `local-authorizers.js` and put it into your
project root (that's where your `serverless.yml` lives). (The filename is hardcoded into plugin.)

If you want the local function to call your deployed shared authorizer it could look something
like this:

```js
const AWS = require("aws-sdk"); 
const mylocalAuthProxyFn = async (event, context) => {

  const lambda = new AWS.Lambda();
  const result = await lambda.invoke({
    FunctionName: "my-shared-lambda-authorizer",
    InvocationType: "RequestResponse",
    Payload: JSON.stringify(event),
  }).promise();

  if (result.StatusCode === 200) {
    return JSON.parse(result.Payload);
  }

  throw Error("Authorizer error");
};

module.exports = { mylocalAuthProxyFn };
```

Of course you could also just return a mocked response, call Cognito to mock your Cognito Authorizer or
whatever suits your needs. You can also define multiple authorizer functions if you need to. Please,
see the [example](/examples/simple/README.md) for the actual codes.

Now in your `serverless.yml`, add the `localAuthorizer` property to your http events. This will not interfere
with your "real" authorizers _and will be ignored upon deployment_. 

```yaml
functions:
  myFunction:
    handler: myFunction.handler
    events:
      - http:
          path: /my/api/path
          method: GET
          authorizer:
            type: CUSTOM
            authorizerId: abcjfk
          localAuthorizer:
            name: "mylocalAuthProxyFn" # <-- the lambda name you have exported in your local-authorizers.js
            type: "request"

```

### Usage B: Auto Configured as proxy

Use a plugin to generate the proxy handler to proxy it to your target serverless-offline lambda

**What you need**

- Your lambda function name.
- (Optional) if you use monorepo, and having your authorizer placed as separate serverless. Your authroizer will most likely running on different lambda port. This field will tell the proxy which lambda URL to invoke upon.

Go ahead to your serverless file.

Specify:

```yaml
custom:
  serverless-offline-local-auth:
    lambdaEndpoint: 'http://127.0.0.1:10000' # if you are running on separate lambda
    lambdaAuthFnName: 'myLambdaFunctionName' # the lambda function to proxy to
    lambdaVersion: 'v3' # the code generate supports both v2 and v3 (v3 is default)
functions:
  myFunction:
    handler: myFunction.handler
    events:
      - http:
          path: /my/api/path
          method: GET
          authorizer:
            type: CUSTOM
            authorizerId: abcjfk
          localAuthorizer:
            name: "autoLocalAuthProxy" # <- specific the auto generated function name here
            type: "request"
```

## Finally 

Fire up serverless offline normally with **start** option:

```yaml
$ sls offline start --stage dev --region eu-central-1
```

## TODO

[ ] make the `localAuthroizer.name` optional.
[ ] Simple example (explicit handler).
[ ] Example for simple proxy (configured with same serverless)
[ ] Example for complex proxy (configured with separate serverless).
[ ] Publish pipeline

## License

MIT
