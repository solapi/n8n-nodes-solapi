import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IHookFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';
import { createHmac, randomBytes } from 'crypto';

function createSolapiAuthHeader(apiKey: string, apiSecret: string): string {
	const dateTime = new Date().toISOString();
	const salt = randomBytes(16).toString('hex');
	const data = `${dateTime}${salt}`;
	const signature = createHmac('sha256', apiSecret).update(data).digest('hex');
	return `HMAC-SHA256 apiKey=${apiKey}, date=${dateTime}, salt=${salt}, signature=${signature}`;
}

async function requestSolapi(
	ctx: any,
	options: Record<string, unknown>,
	itemIndex?: number,
): Promise<unknown> {
	const authType: string =
		(typeof itemIndex === 'number'
			? ctx.getNodeParameter?.('authentication', itemIndex)
			: ctx.getCurrentNodeParameter?.('authentication')) || 'oAuth2';

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
		const result = (await ctx.helpers.request.call(ctx, { ...options, headers: mergedHeaders })) as unknown;
		return parseIfString(result);
	}

	const result = (await ctx.helpers.requestWithAuthentication.call(ctx, 'solapiOAuth2Api', options)) as unknown;
	return parseIfString(result);
}

export class Solapi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Solapi',
		name: 'solapi',
		icon: 'file:solapi.svg',
		group: ['output'],
		version: 1,
		description: 'Send messages with Solapi',
		defaults: {
			name: 'Solapi',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'solapiOAuth2Api',
				required: true,
				displayOptions: {
					show: {
						authentication: ['oAuth2'],
					},
				},
			},
			{
				name: 'solapiApiKeyApi',
				required: true,
				displayOptions: {
					show: {
						authentication: ['apiKey'],
					},
				},
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'solapi',
			},
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
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'message',
				options: [
					{
						name: 'Message',
						value: 'message',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				default: 'sendText',
				options: [
					{
						name: 'On Commerce Action',
						value: 'onCommerceAction',
						description: 'Trigger on Commerce Action events',
						action: 'On commerce action a message',
					},
					{
						name: 'On Group Report',
						value: 'onGroupReport',
						description: 'Trigger on GROUP-REPORT events',
						action: 'On group report a message',
					},
					{
						name: 'On Message Report (Single)',
						value: 'onMessageReport',
						description: 'Trigger on SINGLE-REPORT events',
						action: 'On message report single a message',
					},
					{
						name: 'Send Kakao AlimTalk',
						value: 'sendKakaoATA',
						description: 'Send Kakao AlimTalk (template-based)',
						action: 'Send kakao alim talk a message',
					},
					{
						name: 'Send Kakao FriendTalk',
						value: 'sendKakaoCTA',
						action: 'Send kakao friend talk a message',
					},
					{
						name: 'Send Text Message',
						value: 'sendText',
						description: 'Send SMS/LMS/MMS via Solapi',
						action: 'Send text message a message',
					},
				],
			},
			// Common: To
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				placeholder: '01012341234,01056785678',
				description: '쉼표(,)나 줄바꿈으로 여러 수신번호 입력',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendText', 'sendKakaoATA', 'sendKakaoCTA'],
						resource: ['message'],
					},
				},
				default: '',
			},
			// Text Message fields
			{
				displayName: 'From (Registered Sender ID) Name or ID',
				name: 'from',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getActiveSenderIds',
				},
				displayOptions: {
					show: {
						operation: ['sendText'],
						resource: ['message'],
					},
				},
				default: '',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendText', 'sendKakaoCTA'],
						resource: ['message'],
					},
				},
				default: '',
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['sendText'],
						resource: ['message'],
					},
				},
				default: '',
			},
			{
				displayName: 'Image ID (Optional) Name or ID',
				name: 'imageId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getMmsImages',
				},
				displayOptions: {
					show: {
						operation: ['sendText'],
						resource: ['message'],
					},
				},
				default: '',
			},
			{
				displayName: 'Country Code',
				name: 'country',
				type: 'string',
				default: '82',
				displayOptions: {
					show: {
						operation: ['sendText', 'sendKakaoATA', 'sendKakaoCTA'],
						resource: ['message'],
					},
				},
			},
			// Kakao ATA fields
			{
				displayName: 'Kakao Channel Name or ID',
				name: 'channelId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				displayOptions: {
					show: { operation: ['sendKakaoATA', 'sendKakaoCTA'], resource: ['message'] },
				},
				typeOptions: { loadOptionsMethod: 'getKakaoChannels' },
				default: '',
			},
			{
				displayName: 'Kakao Template Name or ID',
				name: 'templateId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				displayOptions: {
					show: { operation: ['sendKakaoATA'], resource: ['message'] },
				},
				typeOptions: { loadOptionsMethod: 'getKakaoTpls', loadOptionsDependsOn: ['channelId'] },
				default: '',
			},
			{
				displayName: 'Template Variables',
				name: 'variables',
				type: 'fixedCollection',
				displayOptions: {
					show: { operation: ['sendKakaoATA'], resource: ['message'] },
				},
				typeOptions: { multipleValues: true },
				options: [
					{
						displayName: 'Variable',
						name: 'variable',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'options',
								typeOptions: {
									loadOptionsMethod: 'getKakaoTplVariables',
									loadOptionsDependsOn: ['channelId', 'templateId'],
								},
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
				default: {},
			},
			{
				displayName: 'From (Text Replacement Sender, Optional) Name or ID',
				name: 'fromForKakao',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: {
					loadOptionsMethod: 'getActiveSenderIds',
				},
				displayOptions: {
					show: { operation: ['sendKakaoATA', 'sendKakaoCTA'], resource: ['message'] },
				},
				default: '',
			},
			// Kakao CTA fields
			{
				displayName: 'AD Flag',
				name: 'adFlag',
				type: 'boolean',
				displayOptions: {
					show: { operation: ['sendKakaoCTA'], resource: ['message'] },
				},
				default: false,
			},
			{
				displayName: 'CTA Image ID (Optional) Name or ID',
				name: 'kakaoImageId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				typeOptions: { loadOptionsMethod: 'getKakaoImages' },
				displayOptions: {
					show: { operation: ['sendKakaoCTA'], resource: ['message'] },
				},
				default: '',
			},
			{
				displayName: 'Buttons (JSON Array)',
				name: 'buttonsJson',
				type: 'string',
				description: '예: [{"buttonName":"홈","buttonType":"WL","linkMo":"https://..."}]',
				displayOptions: {
					show: { operation: ['sendKakaoCTA'], resource: ['message'] },
				},
				default: '',
			},
			// Commerce Hook fields
			{
				displayName: 'Commerce Hook Name or ID',
				name: 'hookId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				displayOptions: { show: { operation: ['onCommerceAction'], resource: ['message'] } },
				typeOptions: { loadOptionsMethod: 'getCommerceHooks' },
				default: '',
			},
		],
	};

	methods = {
		loadOptions: {
			async getActiveSenderIds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/senderid/v1/numbers/active',
						headers: { Accept: 'application/json' },
					})) as unknown;
					let list: unknown = res;
					if (typeof list === 'string') {
						try {
							list = JSON.parse(list);
						} catch {}
					}
					const arr = Array.isArray(list) ? (list as unknown[]) : [];
					return arr
						.filter((v) => typeof v === 'string' && (v as string).trim())
						.map((num) => ({ name: num as string, value: num as string }));
				} catch (e) {
					return [];
				}
			},
			async getMmsImages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/storage/v1/files',
						qs: { type: 'MMS', limit: 500 },
						headers: { Accept: 'application/json' },
					})) as { fileList?: Array<{ fileId?: string; name?: string }> };
					const list = res?.fileList || [];
					return list.map((f) => ({ name: f.name || f.fileId || '', value: f.fileId || '' }));
				} catch (e) {
					return [];
				}
			},
			async getKakaoImages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/storage/v1/files',
						qs: { type: 'KAKAO', limit: 500 },
						headers: { Accept: 'application/json' },
					})) as { fileList?: Array<{ fileId?: string; name?: string }> };
					const list = res?.fileList || [];
					return list.map((f) => ({ name: f.name || f.fileId || '', value: f.fileId || '' }));
				} catch (e) {
					return [];
				}
			},
			async getKakaoChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/kakao/v2/channels',
						qs: { limit: 200 },
						headers: { Accept: 'application/json' },
					})) as { channelList?: Array<{ channelId?: string; searchId: string, channelName?: string }> };
					const list = res?.channelList || [];
					return list.map((c) => ({ name: `${c.channelName || c.searchId || c.channelId}`, value: c.channelId || '' }));
				} catch (e) {
					return [];
				}
			},
			async getKakaoTpls(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const pfId = (this.getCurrentNodeParameter('channelId') as string) || '';
					if (!pfId) return [];
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/kakao/v1/templates/sendable',
						qs: { pfId },
						headers: { Accept: 'application/json' },
					})) as Array<{ templateId?: string; name?: string; variables?: Array<{ name?: string }> }>;
					return (res || []).map((t) => ({ name: `${t.name}`, value: t.templateId || '', description: t.variables && t.variables.length > 0 ? `vars: ${t.variables.map(v => v.name).join(', ')}` : undefined }));
				} catch (e) {
					return [];
				}
			},
			async getKakaoTplVariables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const pfId = (this.getCurrentNodeParameter('channelId') as string) || '';
					const templateId = (this.getCurrentNodeParameter('templateId') as string) || '';
					if (!pfId || !templateId) return [];
					const res = (await requestSolapi(this, {
						method: 'GET',
						url: 'https://api.solapi.com/kakao/v1/templates/sendable',
						qs: { pfId },
						headers: { Accept: 'application/json' },
					})) as Array<{ templateId?: string; variables?: Array<{ name?: string }> }>;
					const found = (res || []).find(t => t.templateId === templateId);
					const vars = found?.variables || [];
					return vars.map(v => ({ name: v.name || '', value: v.name || '' }));
				} catch (e) {
					return [];
				}
			},
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
					const operation = (this.getNodeParameter('operation', 0) as string) || '';
					if (['onMessageReport', 'onGroupReport', 'onCommerceAction'].indexOf(operation) === -1) return true;
					return false;
				},
				async create(this: IHookFunctions): Promise<boolean> {
					const operation = (this.getNodeParameter('operation', 0) as string) || '';
					if (['onMessageReport', 'onGroupReport', 'onCommerceAction'].indexOf(operation) === -1) return true;
					const url = this.getNodeWebhookUrl('default');
					const isTemporary = this.getMode && this.getMode() === 'manual';
					if (operation === 'onCommerceAction') {
						const hookId = this.getNodeParameter('hookId', 0) as string;
						await requestSolapi(this, {
							method: 'POST',
							url: `https://api.solapi.com/commerce/v1/hooks/${hookId}/connect-webhook`,
							body: { name: 'n8n', webhookUrl: url, isTemporary },
							headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						});
						const data = this.getWorkflowStaticData('node');
						data.commerceHookId = hookId;
						return true;
					}
					const eventId = operation === 'onMessageReport' ? 'SINGLE-REPORT' : 'GROUP-REPORT';
					const response = (await requestSolapi(this, {
						method: 'POST',
						url: 'https://api.solapi.com/webhook/v1/outgoing',
						body: { eventId, url, name: 'n8n', isTemporary },
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					})) as { webhookId?: string };
					const data = this.getWorkflowStaticData('node');
					data.webhookId = (response as any).webhookId || '';
					return true;
				},
				async delete(this: IHookFunctions): Promise<boolean> {
					const data = this.getWorkflowStaticData('node') as { webhookId?: string; commerceHookId?: string };
					if (data.commerceHookId) {
						try {
							await requestSolapi(this, {
								method: 'POST',
								url: `https://api.solapi.com/commerce/v1/hooks/${data.commerceHookId}/disconnect-webhook`,
								headers: { Accept: 'application/json' },
							});
						} catch {}
					}
					if (data.webhookId) {
						try {
							await requestSolapi(this, {
								method: 'DELETE',
								url: `https://api.solapi.com/webhook/v1/outgoing/${data.webhookId}`,
								headers: { Accept: 'application/json' },
							});
						} catch {}
					}
					return true;
				},
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'message' && operation === 'sendText') {
					const toRaw = this.getNodeParameter('to', i) as string;
					const from = this.getNodeParameter('from', i) as string;
					const text = this.getNodeParameter('text', i) as string;
					const subject = this.getNodeParameter('subject', i, '') as string;
					const imageId = this.getNodeParameter('imageId', i, '') as string;
					const country = (this.getNodeParameter('country', i, '82') as string) || '82';

					const recipients = String(toRaw)
						.replace(/\n/g, ',')
						.split(',')
						.map((v) => v.trim())
						.filter((v) => v);

					const messages = recipients.map((to) => {
						const msg: Record<string, unknown> = { to, from, country, text };
						if (subject) msg.subject = subject;
						if (imageId) msg.imageId = imageId;
						return msg;
					});

					const response = await requestSolapi(this, {
						method: 'POST',
						url: 'https://api.solapi.com/messages/v4/send-many/detail',
						body: {
							messages,
							agent: { appId: '9fEGAmn6N2vt' },
						},
						headers: {
							'Content-Type': 'application/json',
							Accept: 'application/json',
						},
					}, i);

					returnData.push({ json: (response as any).body ?? response });
					continue;
				}

				if (resource === 'message' && operation === 'sendKakaoATA') {
					const toRaw = this.getNodeParameter('to', i) as string;
					const channelId = this.getNodeParameter('channelId', i) as string;
					const templateId = this.getNodeParameter('templateId', i) as string;
					const variablesJson = this.getNodeParameter('variablesJson', i, '') as string;
					const from = this.getNodeParameter('fromForKakao', i, '') as string;
					const country = (this.getNodeParameter('country', i, '82') as string) || '82';

					let variables: Record<string, string> | undefined;
					try {
						variables = variablesJson ? (JSON.parse(variablesJson) as Record<string, string>) : undefined;
					} catch {}

					// Assemble variables from dynamic fields if provided
					const variablesCollection = this.getNodeParameter('variables', i, {}) as Record<string, any>;
					if (variablesCollection && Array.isArray((variablesCollection as any).variable)) {
						const arr = (variablesCollection as any).variable as Array<{ name?: string; value?: string }>;
						const kv: Record<string, string> = {};
						for (const entry of arr) {
							if (!entry) continue;
							const key = (entry.name || '').trim();
							const val = (entry.value || '').trim();
							if (key) kv[key] = val;
						}
						if (Object.keys(kv).length > 0) variables = { ...(variables || {}), ...kv };
					}

					const disableSms = !from;
					const recipients = String(toRaw)
						.replace(/\n/g, ',')
						.split(',')
						.map((v) => v.trim())
						.filter((v) => v);

					const kakaoOptions: Record<string, unknown> = { pfId: channelId, templateId, disableSms };
					if (variables && Object.keys(variables).length > 0) {
						kakaoOptions.variables = variables;
					}

					const messages = recipients.map((to) => {
						const msg: Record<string, unknown> = { to, country, kakaoOptions };
						if (from) msg.from = from;
						return msg;
					});

					const response = await requestSolapi(this, {
						method: 'POST',
						url: 'https://api.solapi.com/messages/v4/send-many/detail',
						body: { messages, agent: { appId: '9fEGAmn6N2vt' } },
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					}, i);

					returnData.push({ json: (response as any).body ?? response });
					continue;
				}

				if (resource === 'message' && operation === 'sendKakaoCTA') {
					const toRaw = this.getNodeParameter('to', i) as string;
					const channelId = this.getNodeParameter('channelId', i) as string;
					const text = this.getNodeParameter('text', i) as string;
					const from = this.getNodeParameter('fromForKakao', i, '') as string;
					const adFlag = this.getNodeParameter('adFlag', i, false) as boolean;
					const kakaoImageId = this.getNodeParameter('kakaoImageId', i, '') as string;
					const buttonsJson = this.getNodeParameter('buttonsJson', i, '') as string;
					const country = (this.getNodeParameter('country', i, '82') as string) || '82';

					let buttons: Array<Record<string, unknown>> | undefined;
					try {
						const parsed = buttonsJson ? (JSON.parse(buttonsJson) as Array<Record<string, unknown>>) : undefined;
						if (Array.isArray(parsed) && parsed.length > 0) buttons = parsed;
					} catch {}

					const disableSms = !from;
					const recipients = String(toRaw)
						.replace(/\n/g, ',')
						.split(',')
						.map((v) => v.trim())
						.filter((v) => v);

					const kakaoOptions: Record<string, unknown> = { pfId: channelId, disableSms, adFlag };
					if (kakaoImageId) kakaoOptions.imageId = kakaoImageId;
					if (buttons) kakaoOptions.buttons = buttons.slice(0, 5);

					const messages = recipients.map((to) => {
						const msg: Record<string, unknown> = { to, country, text, kakaoOptions };
						if (from) msg.from = from;
						return msg;
					});

					const response = await requestSolapi(this, {
						method: 'POST',
						url: 'https://api.solapi.com/messages/v4/send-many/detail',
						body: { messages, agent: { appId: '9fEGAmn6N2vt' } },
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					}, i);

					returnData.push({ json: (response as any).body ?? response });
					continue;
				}

				throw new NodeOperationError(this.getNode(), 'Unsupported operation');
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const operation = (this.getNodeParameter('operation', 0) as string) || '';
		if (['onMessageReport', 'onGroupReport', 'onCommerceAction'].indexOf(operation) === -1) {
			return { noWebhookResponse: true };
		}
		const req = this.getRequestObject();
		const body = req.body as unknown;
		const items: INodeExecutionData[] = [];
		if (Array.isArray(body)) {
			for (const entry of body) items.push({ json: (entry as any) as Record<string, any> });
		} else if (body && typeof body === 'object') {
			items.push({ json: (body as any) as Record<string, any> });
		}
		return { workflowData: [items] };
	}
}


