import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { createHmac, randomBytes } from 'crypto';

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

	// The authenticate method is called for every request
	// This allows us to generate a new HMAC signature with current timestamp and random salt
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const apiKey = credentials.apiKey as string;
		const apiSecret = credentials.apiSecret as string;

		// Generate HMAC-SHA256 signature with current timestamp and random salt
		const dateTime = new Date().toISOString();
		const salt = randomBytes(16).toString('hex');
		const data = `${dateTime}${salt}`;
		const signature = createHmac('sha256', apiSecret).update(data).digest('hex');
		const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;

		// Add Authorization header to the request
		const options: IHttpRequestOptions = {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				Authorization: authHeader,
			},
		};

		return options;
	}

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.solapi.com',
			url: '/users/v1/member',
			headers: {
				Accept: 'application/json',
			},
		},
	};
}


