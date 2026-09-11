// Twilio's transitive declaration graph is not strict-compatible with this workspace.
// Keep this facade limited to the package-root API used here so vendor types stay in the adapter.
declare module "twilio" {
  interface Gather {
    pause(attributes: { readonly length: number }): void;
    say(text: string): void;
  }

  interface VoiceResponseInstance {
    gather(attributes: {
      readonly action: string;
      readonly actionOnEmptyResult: boolean;
      readonly finishOnKey: string;
      readonly input: readonly ["dtmf"];
      readonly method: "POST";
      readonly numDigits: number;
      readonly timeout: number;
    }): Gather;
    hangup(): void;
    toString(): string;
  }

  interface VoiceResponseConstructor {
    new (): VoiceResponseInstance;
  }

  interface TwilioPublicApi {
    validateRequest(
      authToken: string,
      signature: string,
      requestUrl: string,
      parameters: Record<string, string>,
    ): boolean;
    readonly twiml: Readonly<{ VoiceResponse: VoiceResponseConstructor }>;
  }

  const twilio: TwilioPublicApi;
  export default twilio;
}
