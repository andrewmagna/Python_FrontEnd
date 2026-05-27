import { createContext, useContext } from "react";

export const SessionContext = createContext({
  session: { loading: true, authenticated: false, user: null, inactivity_timeout_minutes: 15 },
  setSession: () => {},
});

export function useSession() {
  return useContext(SessionContext).session;
}

export function useSetSession() {
  return useContext(SessionContext).setSession;
}
