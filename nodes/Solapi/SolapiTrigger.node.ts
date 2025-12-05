import type { INodeType, INodeTypeDescription, IHookFunctions, IWebhookFunctions, IWebhookResponseData, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import { solapiApiRequest } from './GenericFunctions';

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
					const res = await solapiApiRequest(
						this,
						'GET',
						'/commerce/v1/hooks',
						undefined,
						{ noWebhookSetup: true, actionId: 'EXTERNAL-WEBHOOK', limit: 500 },
					);

					let list: any[] = [];
					if (Array.isArray(res)) {
						list = res;
					} else if (res && typeof res === 'object') {
						list = (res as any).list || (res as any).hookList || (res as any).hooks || [];
					}

					const options = list.map((h: any) => ({
						name: h.name || h.hookId || h.id || 'Unknown',
						value: h.hookId || h.id || '',
					})).filter((opt: any) => opt.value);

					return options;
				} catch {
					return [];
				}
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default');
				const eventType = this.getNodeParameter('eventType', 'commerceAction') as string;
				const data = this.getWorkflowStaticData('node') as { webhookId?: string; commerceHookId?: string; webhookUrl?: string };

				if (eventType === 'commerceAction') {
					const hookId = this.getNodeParameter('hookId', '') as string;
					// 캐시된 데이터로 빠르게 확인
					if (hookId && data.commerceHookId === hookId && data.webhookUrl === url) {
						return true;
					}
					if (!hookId) {
						return false;
					}

					return false;
				}
				const eventId = eventType === 'messageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
				if (data.webhookId && data.webhookUrl === url) return true;
				try {
					const res = (await solapiApiRequest(
						this,
						'GET',
						'/webhook/v1/outgoing',
						undefined,
						{ limit: 200 },
					)) as { list?: Array<{ webhookId?: string; url?: string; eventId?: string }> } | Array<any>;
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
				const eventType = this.getNodeParameter('eventType', 'commerceAction') as string;

				try {
					if (eventType === 'commerceAction') {
						const hookId = this.getNodeParameter('hookId', '') as string;
						await solapiApiRequest(
							this,
							'POST',
							`/commerce/v1/hooks/${hookId}/connect-webhook`,
							{ name: 'n8n', webhookUrl: url, isTemporary },
						);
						const data = this.getWorkflowStaticData('node') as { commerceHookId?: string; webhookUrl?: string };
						data.commerceHookId = hookId;
						data.webhookUrl = url;
						return true;
					}
					const eventId = eventType === 'messageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
					const response = (await solapiApiRequest(
						this,
						'POST',
						'/webhook/v1/outgoing',
						{ eventId, url, name: 'n8n', isTemporary },
					)) as { webhookId?: string };
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
					try {
						await solapiApiRequest(
							this,
							'POST',
							`/commerce/v1/hooks/${data.commerceHookId}/disconnect-webhook`,
						);
					} catch {}
				}
				if (data.webhookId) {
					try {
						await solapiApiRequest(
							this,
							'DELETE',
							`/webhook/v1/outgoing/${data.webhookId}`,
						);
					} catch {}
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
