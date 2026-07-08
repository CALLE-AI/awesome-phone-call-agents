import { type ICredentialDataDecryptedObject, type ICredentialsDecrypted, type ICredentialTestFunctions, type IExecuteFunctions, type INodeCredentialTestResult, type INodeExecutionData, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
export declare class Calle implements INodeType {
    description: INodeTypeDescription;
    methods: {
        credentialTest: {
            calleApiCredentialTest: typeof calleApiCredentialTest;
        };
    };
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
declare function calleApiCredentialTest(this: ICredentialTestFunctions, credential: ICredentialsDecrypted<ICredentialDataDecryptedObject>): Promise<INodeCredentialTestResult>;
export {};
