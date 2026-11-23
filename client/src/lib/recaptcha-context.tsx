import React, { createContext, useContext, useCallback } from "react";
import { useGoogleReCaptcha } from "react-google-recaptcha-v3";

type RecaptchaExecutor = (action: string) => Promise<string | undefined>;

const RecaptchaContext = createContext<RecaptchaExecutor>(async () => undefined);

export function useRecaptcha() {
  return useContext(RecaptchaContext);
}

export function RecaptchaTokenProvider({ children }: { children: React.ReactNode }) {
  const { executeRecaptcha } = useGoogleReCaptcha();
  const getToken = useCallback(async (action: string) => {
    if (!executeRecaptcha) return undefined;
    try {
      return await executeRecaptcha(action);
    } catch {
      return undefined;
    }
  }, [executeRecaptcha]);

  return (
    <RecaptchaContext.Provider value={getToken}>
      {children}
    </RecaptchaContext.Provider>
  );
}

export function RecaptchaNoopProvider({ children }: { children: React.ReactNode }) {
  return (
    <RecaptchaContext.Provider value={async () => undefined}>
      {children}
    </RecaptchaContext.Provider>
  );
}
