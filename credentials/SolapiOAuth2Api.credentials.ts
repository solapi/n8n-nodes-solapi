import type {
    ICredentialTestRequest,
    ICredentialType,
    INodeProperties,
} from 'n8n-workflow';

export class SolapiOAuth2Api implements ICredentialType {
    name = 'solapiOAuth2Api';
    displayName = 'Solapi OAuth2 API';
    documentationUrl = 'https://developers.solapi.com/';

    properties: INodeProperties[] = [
        {
            displayName: 'Scope',
            name: 'scope',
            type: 'string',
            default:
                'message:write message:read senderid:read storage:write storage:read webhook:read webhook:write kakao:write kakao:read users:read contacts:read contacts:write commerce:read commerce:write',
        },
        {
            displayName: 'Authorization URL',
            name: 'authUrl',
            type: 'hidden',
            default: 'https://api.solapi.com/oauth2/v1/authorize',
        },
        {
            displayName: 'Access Token URL',
            name: 'accessTokenUrl',
            type: 'hidden',
            default: 'https://api.solapi.com/oauth2/v1/access_token',
        },
    ];

    test: ICredentialTestRequest = {
        request: {
            baseURL: 'https://api.solapi.com',
            url: '/users/v1/member',
            headers: {
                Accept: 'application/json',
            },
        },
    };

    extends = ['oAuth2Api'];
}


