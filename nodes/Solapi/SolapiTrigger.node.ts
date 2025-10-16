import type { INodeType, INodeTypeDescription, IHookFunctions, IWebhookFunctions, IWebhookResponseData, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import { createHmac, randomBytes } from 'crypto';

function createSolapiAuthHeader(apiKey: string, apiSecret: string): string {
	const dateTime = new Date().toISOString();
	const salt = randomBytes(16).toString('hex');
	const data = `${dateTime}${salt}`;
	const signature = createHmac('sha256', apiSecret).update(data).digest('hex');
	return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

async function requestSolapi(ctx: any, options: Record<string, unknown>): Promise<unknown> {
	const authType: string =
		(ctx.getNodeParameter?.('authentication', 0) as string | undefined) ??
		(ctx.getCurrentNodeParameter?.('authentication') as string | undefined) ??
		'oAuth2';

	const parseIfString = (input: unknown): unknown => {
		if (typeof input === 'string') {
			try {
				return JSON.parse(input);
			} catch {
				return input;
			}
		}
		return input;
	};

	if (authType === 'apiKey') {
		const credentials = await ctx.getCredentials('solapiApiKeyApi');
		const apiKey = String(credentials.apiKey || '');
		const apiSecret = String(credentials.apiSecret || '');
		const authHeader = createSolapiAuthHeader(apiKey, apiSecret);
		const mergedHeaders = {
			...(options.headers as Record<string, string> | undefined),
			Authorization: authHeader,
		};
		const result = (await ctx.helpers.httpRequest.call(ctx, { ...options, headers: mergedHeaders })) as unknown;
		return parseIfString(result);
	}

	const result = (await ctx.helpers.requestWithAuthentication.call(ctx, 'solapiOAuth2Api', options)) as unknown;
	return parseIfString(result);
}

export class SolapiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Solapi Trigger',
		name: 'solapiTrigger',
		icon: 'file:solapi.svg',
		group: ['trigger'],
		version: 1,
		description: 'Trigger on Solapi events',
		defaults: {
			name: 'Solapi Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{ name: 'solapiOAuth2Api', required: true, displayOptions: { show: { authentication: ['oAuth2'] } } },
			{ name: 'solapiApiKeyApi', required: true, displayOptions: { show: { authentication: ['apiKey'] } } },
		],
		webhooks: [
			{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'solapi' },
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				default: 'oAuth2',
				options: [
					{ name: 'OAuth2', value: 'oAuth2' },
					{ name: 'API Key (HMAC-SHA256)', value: 'apiKey' },
				],
			},
			{
				displayName: 'Event Type',
				name: 'eventType',
				type: 'options',
				default: 'commerceAction',
				options: [
					{ name: 'On Commerce Action', value: 'commerceAction' },
					{ name: 'On Group Report', value: 'groupReport' },
					{ name: 'On Message Report (Single)', value: 'messageReport' },
				],
			},
			{
				displayName: 'Commerce Hook Name or ID',
				name: 'hookId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				displayOptions: { show: { eventType: ['commerceAction'] } },
				typeOptions: { loadOptionsMethod: 'getCommerceHooks' },
				default: '',
			},
		],
	};

	methods = {
		loadOptions: {
			async getCommerceHooks(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/commerce/v1/hooks',
						qs: { noWebhookSetup: true, actionId: 'EXTERNAL-WEBHOOK', limit: 500 },
						headers: { Accept: 'application/json' },
					})) as { list?: Array<{ hookId?: string; name?: string }> };
					const list = (res as any)?.list || [];
					return list.map((h: any) => ({ name: h.name || h.hookId, value: h.hookId }));
				} catch (e) {
					return [];
				}
			},
		},
		webhook: {
			default: {
				async checkExists(this: IHookFunctions): Promise<boolean> {
					const url = this.getNodeWebhookUrl('default');
					const eventType = (this.getNodeParameter('eventType', 0) as string) || 'commerceAction';
					const data = this.getWorkflowStaticData('node') as { webhookId?: string; commerceHookId?: string; webhookUrl?: string };

					if (eventType === 'commerceAction') {
						const hookId = (this.getNodeParameter('hookId', 0) as string) || '';
						if (hookId && data.commerceHookId === hookId && data.webhookUrl === url) return true;
						if (!hookId) return false;
						try {
							const res = (await requestSolapi(this, {
								method: 'GET',
								url: `https://api.solapi.com/commerce/v1/hooks/${hookId}`,
								headers: { Accept: 'application/json' },
							})) as { webhookUrl?: string; webhook?: { url?: string } };
							const currentUrl = (res as any)?.webhookUrl || (res as any)?.webhook?.url;
							if (currentUrl && currentUrl === url) {
								data.commerceHookId = hookId;
								data.webhookUrl = url;
								return true;
							}
						} catch {}
						try {
							const res = (await requestSolapi(this, {
								method: 'GET',
								url: 'https://api.solapi.com/commerce/v1/hooks',
								qs: { limit: 500 },
								headers: { Accept: 'application/json' },
							})) as { list?: Array<{ hookId?: string; webhookUrl?: string; webhook?: { url?: string } }> } | Array<any>;
							const arr = Array.isArray(res) ? (res as any[]) : (((res as any)?.list as any[]) || []);
							const found = (arr as any[]).find((h: any) => (h?.hookId === hookId) && ((h?.webhookUrl === url) || (h?.webhook?.url === url)));
							if (found) {
								data.commerceHookId = hookId;
								data.webhookUrl = url;
								return true;
							}
						} catch {}
						return false;
					}
					const eventId = eventType === 'messageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
					if (data.webhookId && data.webhookUrl === url) return true;
					try {
						const res = (await requestSolapi(this, {
							method: 'GET',
							url: 'https://api.solapi.com/webhook/v1/outgoing',
							qs: { limit: 200 },
							headers: { Accept: 'application/json' },
						})) as { list?: Array<{ webhookId?: string; url?: string; eventId?: string }> } | Array<any>;
						const arr = Array.isArray(res) ? (res as any[]) : (((res as any)?.list as any[]) || (res as any)?.webhookList || []);
						const found = (arr as any[]).find((w: any) => (w?.url === url) && (!w?.eventId || w?.eventId === eventId));
						if (found?.webhookId) {
							data.webhookId = found.webhookId;
							data.webhookUrl = url;
							return true;
						}
					} catch {}
					return false;
				},
				async create(this: IHookFunctions): Promise<boolean> {
					const url = this.getNodeWebhookUrl('default');
					const isTemporary = this.getMode && this.getMode() === 'manual';
					const eventType = (this.getNodeParameter('eventType', 0) as string) || 'commerceAction';

					try {
						if (eventType === 'commerceAction') {
							const hookId = this.getNodeParameter('hookId', 0) as string;
							await requestSolapi(this, {
								method: 'POST',
								url: `https://api.solapi.com/commerce/v1/hooks/${hookId}/connect-webhook`,
								body: { name: 'n8n', webhookUrl: url, isTemporary },
								headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
							});
							const data = this.getWorkflowStaticData('node') as { commerceHookId?: string; webhookUrl?: string };
							data.commerceHookId = hookId;
							data.webhookUrl = url;

							return true;
						}
						const eventId = eventType === 'messageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
						const response = (await requestSolapi(this, {
							method: 'POST',
							url: 'https://api.solapi.com/webhook/v1/outgoing',
							body: { eventId, url, name: 'n8n', isTemporary },
							headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						})) as { webhookId?: string };
						const data = this.getWorkflowStaticData('node') as { webhookId?: string; webhookUrl?: string };
						data.webhookId = (response as any).webhookId || '';
						data.webhookUrl = url;

						return true;
					} catch (e) {
						throw new NodeOperationError(this.getNode(), `Failed to create Solapi webhook: ${(e as any)?.message || 'unknown error'}`);
					}
				},
				async delete(this: IHookFunctions): Promise<boolean> {
					const data = this.getWorkflowStaticData('node') as { webhookId?: string; commerceHookId?: string };
					if (data.commerceHookId) {

						await requestSolapi(this, {
							method: 'POST',
							url: `https://api.solapi.com/commerce/v1/hooks/${data.commerceHookId}/disconnect-webhook`,
							headers: { Accept: 'application/json' },
						});
					}
					if (data.webhookId) {
						await requestSolapi(this, {
							method: 'DELETE',
							url: `https://api.solapi.com/webhook/v1/outgoing/${data.webhookId}`,
							headers: { Accept: 'application/json' },
						});
					}
					return true;
				},
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const eventType = (this.getNodeParameter('eventType', 0) as string) || 'commerceAction';
				const data = this.getWorkflowStaticData('node') as { webhookId?: string; commerceHookId?: string; webhookUrl?: string };

				if (eventType === 'commerceAction') {
					const hookId = (this.getNodeParameter('hookId', 0) as string) || '';
					if (hookId && data.commerceHookId === hookId && data.webhookUrl === url) return true;
					if (!hookId) return false;
					try {
						const res = (await requestSolapi(this, {
							method: 'GET',
							url: `https://api.solapi.com/commerce/v1/hooks/${hookId}`,
							headers: { Accept: 'application/json' },
						})) as { webhookUrl?: string; webhook?: { url?: string } };
						const currentUrl = (res as any)?.webhookUrl || (res as any)?.webhook?.url;
						if (currentUrl && currentUrl === url) {
							data.commerceHookId = hookId;
							data.webhookUrl = url;
							return true;
						}
					} catch {}
					try {
						const res = (await requestSolapi(this, {
							method: 'GET',
							url: 'https://api.solapi.com/commerce/v1/hooks',
							qs: { limit: 500 },
							headers: { Accept: 'application/json' },
						})) as { list?: Array<{ hookId?: string; webhookUrl?: string; webhook?: { url?: string } }> } | Array<any>;
						const arr = Array.isArray(res) ? (res as any[]) : (((res as any)?.list as any[]) || []);
						const found = (arr as any[]).find((h: any) => (h?.hookId === hookId) && ((h?.webhookUrl === url) || (h?.webhook?.url === url)));
						if (found) {
							data.commerceHookId = hookId;
							data.webhookUrl = url;
							return true;
						}
					} catch {}
					return false;
				}
				const eventId = eventType === 'messageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
				if (data.webhookId && data.webhookUrl === url) return true;
				try {
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/webhook/v1/outgoing',
						qs: { limit: 200 },
						headers: { Accept: 'application/json' },
					})) as { list?: Array<{ webhookId?: string; url?: string; eventId?: string }> } | Array<any>;
					const arr = Array.isArray(res) ? (res as any[]) : (((res as any)?.list as any[]) || (res as any)?.webhookList || []);
					const found = (arr as any[]).find((w: any) => (w?.url === url) && (!w?.eventId || w?.eventId === eventId));
					if (found?.webhookId) {
						data.webhookId = found.webhookId;
						data.webhookUrl = url;
						return true;
					}
				} catch {}
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const isTemporary = this.getMode && this.getMode() === 'manual';
				const eventType = (this.getNodeParameter('eventType', 0) as string) || 'commerceAction';

				try {
					if (eventType === 'commerceAction') {
						const hookId = this.getNodeParameter('hookId', 0) as string;
						await requestSolapi(this, {
							method: 'POST',
							url: `https://api.solapi.com/commerce/v1/hooks/${hookId}/connect-webhook`,
							body: { name: 'n8n', webhookUrl: url, isTemporary },
							headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						});
						const data = this.getWorkflowStaticData('node') as { commerceHookId?: string; webhookUrl?: string };
						data.commerceHookId = hookId;
						data.webhookUrl = url;

						return true;
					}
					const eventId = eventType === 'messageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
					const response = (await requestSolapi(this, {
						method: 'POST',
						url: 'https://api.solapi.com/webhook/v1/outgoing',
						body: { eventId, url, name: 'n8n', isTemporary },
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					})) as { webhookId?: string };
					const data = this.getWorkflowStaticData('node') as { webhookId?: string; webhookUrl?: string };
					data.webhookId = (response as any).webhookId || '';
					data.webhookUrl = url;

					return true;
				} catch (e) {
					throw new NodeOperationError(this.getNode(), `Failed to create Solapi webhook: ${(e as any)?.message || 'unknown error'}`);
				}
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node') as { webhookId?: string; commerceHookId?: string };
				if (data.commerceHookId) {
					await requestSolapi(this, {
						method: 'POST',
						url: `https://api.solapi.com/commerce/v1/hooks/${data.commerceHookId}/disconnect-webhook`,
						headers: { Accept: 'application/json' },
					});
				}
				if (data.webhookId) {
					await requestSolapi(this, {
						method: 'DELETE',
						url: `https://api.solapi.com/webhook/v1/outgoing/${data.webhookId}`,
						headers: { Accept: 'application/json' },
					});
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const body = req.body as unknown;
		const items: Array<{ json: Record<string, any> }> = [];
		if (Array.isArray(body)) {
			for (const entry of body) items.push({ json: (entry as any) as Record<string, any> });
		} else if (body && typeof body === 'object') {
			items.push({ json: (body as any) as Record<string, any> });
		}
		return { workflowData: [items] };
	}
}


