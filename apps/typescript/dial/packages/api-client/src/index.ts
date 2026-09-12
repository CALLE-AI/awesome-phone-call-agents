import type {
  AuthResponse,
  SessionUser,
  TaskSummary,
  TaskDetail,
  TaskListResponse,
  UserSettings,
  HealthResponse,
  CreateTaskRequest,
  Contact,
  ImportContactsResponse,
  BusinessDto,
  BusinessListEntry,
  BusinessDashboard,
  BusinessContactDto,
  BusinessRunDto,
  BusinessRunSummaryDto,
  WorkflowDto,
  CreateBusinessRequest,
  CreateRunRequest,
  UsageResponse,
  TaskSuggestionsResponse,
  ImportBusinessContactsResponse,
} from '@dial/schemas';

/**
 * One typed HTTP client, used verbatim by the web app and the mobile app.
 *
 * Auth differs by platform and is handled by the two hooks below rather than by
 * branching inside every call: the browser relies on an httpOnly cookie
 * (`credentials: 'include'`), while React Native supplies a bearer token from
 * secure storage. Nothing here ever holds a server secret.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when the user simply needs to sign in again. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns a bearer token, or null to rely on cookies. */
  getToken?: () => string | null | Promise<string | null>;
  /** Included so the browser sends its session cookie. */
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

export class DialApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  private async request<T>(
    path: string,
    init: RequestInit & { method?: string } = {},
  ): Promise<T> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const token = this.options.getToken ? await this.options.getToken() : null;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await doFetch(`${this.options.baseUrl}${path}`, {
        ...init,
        headers,
        credentials: this.options.credentials,
      });
    } catch {
      // Offline, DNS failure, server down — a distinct, actionable state.
      throw new ApiError('network_error', 'Dial could not reach the server.', 0);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string } })?.error;
      throw new ApiError(
        error?.code ?? 'request_failed',
        // A status code is not a message. This only fires when the body was
        // unreadable, which the user can do nothing about either way.
        error?.message ?? 'Dial could not complete that just now. Please try again.',
        response.status,
      );
    }
    return body as T;
  }

  /* ------------------------------------------------------------------ auth */

  signUp(input: { email: string; password: string; name: string }): Promise<AuthResponse> {
    return this.request('/api/auth/sign-up', { method: 'POST', body: JSON.stringify(input) });
  }

  signIn(input: { email: string; password: string }): Promise<AuthResponse> {
    return this.request('/api/auth/sign-in', { method: 'POST', body: JSON.stringify(input) });
  }

  signOut(): Promise<{ ok: boolean }> {
    return this.request('/api/auth/sign-out', { method: 'POST' });
  }

  me(): Promise<{ user: SessionUser }> {
    return this.request('/api/auth/me');
  }

  /* ----------------------------------------------------------------- tasks */

  listTasks(cursor?: string | null): Promise<TaskListResponse> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request(`/api/tasks${query}`);
  }

  createTask(input: CreateTaskRequest): Promise<TaskSummary> {
    return this.request('/api/tasks', { method: 'POST', body: JSON.stringify(input) });
  }

  getTask(id: string): Promise<TaskDetail> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}`);
  }

  answerClarification(id: string, answer: string): Promise<TaskDetail> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}/clarify`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    });
  }

  /** Answers the intake questions. Pass `skipped` when the user chose to skip. */
  answerQuestions(
    id: string,
    answers: Array<{ id: string; answer: string }>,
    skipped = false,
  ): Promise<TaskDetail> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}/answers`, {
      method: 'POST',
      body: JSON.stringify({ answers, skipped }),
    });
  }

  /**
   * Asks Dial to ring a business back and do something -- make the
   * appointment, place the order. Returns the new task it started.
   */
  actOnBusiness(taskId: string, candidateId: string, instruction: string): Promise<TaskSummary> {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/act-on-business`, {
      method: 'POST',
      body: JSON.stringify({ candidateId, instruction }),
    });
  }

  /** Calls one business the user picked out of the list Dial found. */
  callCandidate(taskId: string, candidateId: string): Promise<TaskDetail> {
    return this.request(`/api/tasks/${encodeURIComponent(taskId)}/call-candidate`, {
      method: 'POST',
      body: JSON.stringify({ candidateId }),
    });
  }

  /* Contacts: numbers the user chose to keep. */

  listContacts(): Promise<{ contacts: Contact[] }> {
    return this.request('/api/contacts');
  }

  /**
   * Keeps a number. Pass `taskId` to save the number a task used, so the raw
   * number never has to travel back to the client and in again.
   */
  saveContact(input: { name: string; phone?: string; taskId?: string }): Promise<Contact> {
    return this.request('/api/contacts', { method: 'POST', body: JSON.stringify(input) });
  }

  renameContact(id: string, name: string): Promise<Contact> {
    return this.request(`/api/contacts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  deleteContact(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /**
   * Imports device address-book entries in one call. The server normalizes
   * and validates each number; entries it cannot dial come back as `skipped`
   * rather than failing the batch.
   */
  importContacts(
    contacts: Array<{ name: string; phone: string }>,
  ): Promise<ImportContactsResponse> {
    return this.request('/api/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ contacts }),
    });
  }

  /* ------------------------------------------------------------------ push */

  registerPushToken(token: string, platform: 'ios' | 'android'): Promise<{ ok: boolean }> {
    return this.request('/api/push/register', {
      method: 'POST',
      body: JSON.stringify({ token, platform }),
    });
  }

  unregisterPushToken(token: string): Promise<{ ok: boolean }> {
    return this.request('/api/push/unregister', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  decideAuthorization(id: string, approved: boolean): Promise<TaskDetail> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}/authorization`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
  }

  cancelTask(id: string): Promise<{ ok: boolean; callsAlreadyInFlight: number; note: string | null }> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  }

  deleteTask(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /* ------------------------------------------------------- business mode */

  listBusinesses(): Promise<{
    businesses: BusinessListEntry[];
    templates: Array<{ id: string; label: string; description: string }>;
  }> {
    return this.request('/api/businesses');
  }

  createBusiness(input: CreateBusinessRequest): Promise<BusinessDto> {
    return this.request('/api/businesses', { method: 'POST', body: JSON.stringify(input) });
  }

  getBusiness(id: string): Promise<BusinessDto> {
    return this.request(`/api/businesses/${encodeURIComponent(id)}`);
  }

  updateBusiness(id: string, patch: Partial<CreateBusinessRequest> & { status?: string }): Promise<BusinessDto> {
    return this.request(`/api/businesses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  deleteBusiness(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/businesses/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  businessDashboard(id: string): Promise<BusinessDashboard> {
    return this.request(`/api/businesses/${encodeURIComponent(id)}/dashboard`);
  }

  listWorkflows(businessId: string): Promise<{
    workflows: WorkflowDto[];
    templates: Array<{
      id: string;
      label: string;
      description: string;
      direction: string;
      contextFields: Array<{ id: string; label: string; type: string; required: boolean; hint?: string }>;
    }>;
  }> {
    return this.request(`/api/businesses/${encodeURIComponent(businessId)}/workflows`);
  }

  createWorkflow(
    businessId: string,
    input: {
      name: string;
      template: string;
      goal?: string | null;
      defaultLocale?: string;
      callingHours?: { startHour?: number; endHour?: number } | null;
      retry?: { maxAttempts?: number } | null;
    },
  ): Promise<WorkflowDto> {
    return this.request(`/api/businesses/${encodeURIComponent(businessId)}/workflows`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateWorkflow(
    businessId: string,
    workflowId: string,
    patch: {
      name?: string;
      goal?: string | null;
      defaultLocale?: string;
      enabled?: boolean;
      callingHours?: { startHour?: number; endHour?: number };
      retry?: { maxAttempts?: number };
    },
  ): Promise<WorkflowDto> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/workflows/${encodeURIComponent(workflowId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  }

  deleteWorkflow(businessId: string, workflowId: string): Promise<{ ok: boolean }> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/workflows/${encodeURIComponent(workflowId)}`,
      { method: 'DELETE' },
    );
  }

  listBusinessContacts(
    businessId: string,
    query?: string,
  ): Promise<{ contacts: BusinessContactDto[] }> {
    const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request(`/api/businesses/${encodeURIComponent(businessId)}/contacts${suffix}`);
  }

  createBusinessContact(
    businessId: string,
    input: { name: string; phone: string; email?: string | null; metadata?: Record<string, string> | null },
  ): Promise<BusinessContactDto> {
    return this.request(`/api/businesses/${encodeURIComponent(businessId)}/contacts`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateBusinessContact(
    businessId: string,
    contactId: string,
    patch: { name?: string; phone?: string; email?: string | null; doNotCall?: boolean },
  ): Promise<BusinessContactDto> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
  }

  deleteBusinessContact(businessId: string, contactId: string): Promise<{ ok: boolean }> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/contacts/${encodeURIComponent(contactId)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Uploads a customer list to ONE business.
   *
   * These never touch the user's own contacts: different table, different
   * screen. Pass `dryRun` to see what a file contains before writing it.
   */
  importBusinessContacts(
    businessId: string,
    input: { filename: string; contentBase64: string; dryRun?: boolean },
  ): Promise<ImportBusinessContactsResponse> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/contacts/import`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  createRun(businessId: string, workflowId: string, input: CreateRunRequest): Promise<{ run: BusinessRunDto }> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/workflows/${encodeURIComponent(workflowId)}/runs`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  listRuns(businessId: string): Promise<{ runs: BusinessRunSummaryDto[] }> {
    return this.request(`/api/businesses/${encodeURIComponent(businessId)}/runs`);
  }

  getRun(businessId: string, runId: string): Promise<{ run: BusinessRunDto }> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}`,
    );
  }

  cancelRun(businessId: string, runId: string): Promise<{ ok: boolean }> {
    return this.request(
      `/api/businesses/${encodeURIComponent(businessId)}/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' },
    );
  }

  /* -------------------------------------------------------------- settings */

  getSettings(): Promise<UserSettings> {
    return this.request('/api/settings');
  }

  updateSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    return this.request('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
  }

  /**
   * Stops Dial starting anything new, and stops the task clock.
   *
   * A call already ringing cannot be pulled back -- CALL-E exposes no
   * cancellation -- so it finishes and its answer is still recorded.
   */
  pauseTask(id: string): Promise<TaskSummary> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}/pause`, { method: 'POST' });
  }

  /** Picks the task up from where it stopped, clock included. */
  resumeTask(id: string): Promise<TaskSummary> {
    return this.request(`/api/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' });
  }

  /** Things this user has done before, ready to run again. */
  getSuggestions(limit = 4): Promise<TaskSuggestionsResponse> {
    return this.request(`/api/suggestions?limit=${encodeURIComponent(String(limit))}`);
  }

  /** Calls and tasks used, against the ceilings that actually bound them. */
  getUsage(days = 14): Promise<UsageResponse> {
    return this.request(`/api/usage?days=${encodeURIComponent(String(days))}`);
  }

  resolveLocation(input: { text?: string; latitude?: number; longitude?: number }): Promise<{
    latitude: number;
    longitude: number;
    label: string;
    countryCode: string | null;
  }> {
    return this.request('/api/location/resolve', { method: 'POST', body: JSON.stringify(input) });
  }

  deleteAccount(): Promise<{ ok: boolean }> {
    return this.request('/api/account', { method: 'DELETE' });
  }

  health(): Promise<HealthResponse> {
    return this.request('/health');
  }

  /** URL for the SSE progress stream. */
  eventsUrl(taskId?: string): string {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    return `${this.options.baseUrl}/api/events${query}`;
  }
}

export interface ProgressEvent {
  type: 'state' | 'event' | 'call' | 'result';
  taskId: string;
  state?: string;
  message?: string;
  at: string;
}
