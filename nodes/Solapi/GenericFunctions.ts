import type { IDataObject } from 'n8n-workflow';

export const SOLAPI_API_BASE_URL = 'https://api.solapi.com';

export function parseIfString(input: unknown): unknown {
	if (typeof input === 'string') {
		try {
			return JSON.parse(input);
		} catch {
			return input;
		}
	}
	return input;
}

export async function solapiApiRequest(
	ctx: any,
	method: string,
	endpoint: string,
	body?: IDataObject | string,
	qs?: IDataObject,
	headers?: IDataObject,
	itemIndex?: number,
): Promise<unknown> {
	const authType: string =
		(typeof itemIndex === 'number'
			? ctx.getNodeParameter?.('authentication', itemIndex)
			: ctx.getCurrentNodeParameter?.('authentication')) || 'oAuth2';

	const requestHeaders: IDataObject = {
		Accept: 'application/json',
		...headers,
	};

	if (body && typeof body === 'object') {
		requestHeaders['Content-Type'] = 'application/json';
	}

	const options: IDataObject = {
		method,
		url: endpoint.startsWith('http') ? endpoint : `${SOLAPI_API_BASE_URL}${endpoint}`,
		headers: requestHeaders,
	};

	if (body) {
		options.body = body;
	}

	if (qs && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	const credentialType = authType === 'apiKey' ? 'solapiApiKeyApi' : 'solapiOAuth2Api';
	const result = await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		credentialType,
		options,
	);

	return parseIfString(result);
}

