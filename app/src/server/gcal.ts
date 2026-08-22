import { DurableObjectOAuthClientProvider } from "agents/mcp/do-oauth-client-provider";

/**
 * Google's hosted Calendar MCP server (remote, streamable HTTP, OAuth 2.0
 * with a pre-registered client — Google does no dynamic registration).
 * https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server
 */
export const GCAL_MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";

/** Read-only scopes — PI looks at calendars, never touches them. */
export const GCAL_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

export const GCAL_CALLBACK_PATH = "/oauth/google/callback";

/** Where a user's Google tokens live — the desk DO, shared by their chats. */
export type GcalTokenStore = {
  get(): Promise<unknown>;
  set(tokens: unknown): Promise<void>;
};

/**
 * OAuth provider for Google's Calendar MCP server. Differs from the stock
 * dynamic-registration provider in three ways: a pre-registered client, a
 * fixed redirect URI (Google requires exact matches), and token persistence
 * delegated to the user's desk DO so consent happens once, not per chat.
 */
export class GoogleOAuthProvider extends DurableObjectOAuthClientProvider {
  constructor(
    storage: DurableObjectStorage,
    clientName: string,
    private readonly fixedRedirectUrl: string,
    private readonly client: { client_id: string; client_secret: string },
    private readonly tokenStore: GcalTokenStore
  ) {
    super(storage, clientName, fixedRedirectUrl);
  }

  override get redirectUrl(): string {
    return this.fixedRedirectUrl;
  }

  override get clientMetadata() {
    return {
      ...super.clientMetadata,
      redirect_uris: [this.fixedRedirectUrl],
      scope: GCAL_SCOPES.join(" "),
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async clientInformation(): Promise<any> {
    return { ...this.client };
  }

  override async saveClientInformation(): Promise<void> {
    // Pre-registered in Google Cloud — nothing to persist, never overwrite.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async tokens(): Promise<any> {
    return (await this.tokenStore.get()) ?? undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async saveTokens(tokens: any): Promise<void> {
    await this.tokenStore.set(tokens);
  }

  override async redirectToAuthorization(authUrl: URL): Promise<void> {
    // Without offline access Google issues no refresh token and the
    // connection would die within the hour; prompt=consent guarantees a
    // refresh token on re-grants too.
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    await super.redirectToAuthorization(authUrl);
  }
}
