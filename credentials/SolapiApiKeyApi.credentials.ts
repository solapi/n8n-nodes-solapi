import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class SolapiApiKeyApi implements ICredentialType {
    name = 'solapiApiKeyApi';
    displayName = 'Solapi API Key API';
    documentationUrl = 'https://developers.solapi.com/references/authentication/api-key';

    properties: INodeProperties[] = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
        },
        {
            displayName: 'API Secret',
            name: 'apiSecret',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
        },
    ];
}


