import { createContext, useContext } from 'react';

export interface AuthCtx {
  username: string;
  logout: () => void;
}

export const AuthContext = createContext<AuthCtx>({ username: '', logout: () => {} });
export const useAuth = () => useContext(AuthContext);
