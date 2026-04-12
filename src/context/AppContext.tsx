import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  Mitarbeiter,
  Tour,
  Teilgebiet,
  Parameter,
  Abrechnungsperiode,
} from '../types';
import {
  mitarbeiterListener,
  tourenListener,
  teilgebieteListener,
  parameterListener,
  abrechnungsperiodenListener,
} from '../lib/db';

// ---- State -------------------------------------------------

export type UserRole = 'admin' | 'abrechnung' | null;

interface AppState {
  userRole: UserRole;
  adminName: string;
  mitarbeiter: Mitarbeiter[];
  touren: Tour[];
  teilgebiete: Teilgebiet[];
  parameter: Parameter | null;
  abrechnungsperioden: Abrechnungsperiode[];
  aktivePeriodeId: string | null;
  isOnline: boolean;
  isLoading: boolean;
}

const initialState: AppState = {
  userRole: null,
  adminName: '',
  mitarbeiter: [],
  touren: [],
  teilgebiete: [],
  parameter: null,
  abrechnungsperioden: [],
  aktivePeriodeId: null,
  isOnline: navigator.onLine,
  isLoading: true,
};

// ---- Actions -----------------------------------------------

type Action =
  | { type: 'SET_AUTH'; payload: { role: UserRole; name: string } }
  | { type: 'SET_MITARBEITER'; payload: Mitarbeiter[] }
  | { type: 'SET_TOUREN'; payload: Tour[] }
  | { type: 'SET_TEILGEBIETE'; payload: Teilgebiet[] }
  | { type: 'SET_PARAMETER'; payload: Parameter | null }
  | { type: 'SET_ABRECHNUNGSPERIODEN'; payload: Abrechnungsperiode[] }
  | { type: 'SET_AKTIVE_PERIODE'; payload: string | null }
  | { type: 'SET_ONLINE'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_AUTH':
      return {
        ...state,
        userRole: action.payload.role,
        adminName: action.payload.name,
        // Abwärtskompatibilität
        isAdminAuthenticated: action.payload.role !== null,
      } as AppState;
    case 'SET_MITARBEITER':
      return { ...state, mitarbeiter: action.payload };
    case 'SET_TOUREN':
      return { ...state, touren: action.payload };
    case 'SET_TEILGEBIETE':
      return { ...state, teilgebiete: action.payload };
    case 'SET_PARAMETER':
      return { ...state, parameter: action.payload };
    case 'SET_ABRECHNUNGSPERIODEN':
      return { ...state, abrechnungsperioden: action.payload };
    case 'SET_AKTIVE_PERIODE':
      return { ...state, aktivePeriodeId: action.payload };
    case 'SET_ONLINE':
      return { ...state, isOnline: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    default:
      return state;
  }
}

// ---- Context -----------------------------------------------

interface AppContextValue extends AppState {
  // Abwärtskompatibilität
  isAdminAuthenticated: boolean;
  // Neue Methoden
  loginAdmin: (name: string) => void;
  loginAbrechnung: (name: string) => void;
  logoutAdmin: () => void;
  setAktivePeriode: (id: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ---- Provider ----------------------------------------------

const SESSION_KEY = 'userSession';

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState, () => {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) {
      const { role, name } = JSON.parse(session) as { role: UserRole; name: string };
      return { ...initialState, userRole: role, adminName: name };
    }
    return initialState;
  });

  // Online/Offline
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'SET_ONLINE', payload: true });
    const onOffline = () => dispatch({ type: 'SET_ONLINE', payload: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Firestore-Listener für Stammdaten
  useEffect(() => {
    let loaded = 0;
    const checkLoaded = () => {
      loaded++;
      if (loaded >= 4) dispatch({ type: 'SET_LOADING', payload: false });
    };

    const unsubMitarbeiter = mitarbeiterListener((list) => {
      dispatch({ type: 'SET_MITARBEITER', payload: list });
      checkLoaded();
    });
    const unsubTouren = tourenListener((list) => {
      dispatch({ type: 'SET_TOUREN', payload: list });
      checkLoaded();
    });
    const unsubTeilgebiete = teilgebieteListener((list) => {
      dispatch({ type: 'SET_TEILGEBIETE', payload: list });
      checkLoaded();
    });
    const unsubParameter = parameterListener((params) => {
      dispatch({ type: 'SET_PARAMETER', payload: params });
      checkLoaded();
    });
    const unsubPerioden = abrechnungsperiodenListener((list) => {
      dispatch({ type: 'SET_ABRECHNUNGSPERIODEN', payload: list });
    });

    return () => {
      unsubMitarbeiter();
      unsubTouren();
      unsubTeilgebiete();
      unsubParameter();
      unsubPerioden();
    };
  }, []);

  const loginAdmin = useCallback((name: string) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: 'admin', name }));
    dispatch({ type: 'SET_AUTH', payload: { role: 'admin', name } });
  }, []);

  const loginAbrechnung = useCallback((name: string) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: 'abrechnung', name }));
    dispatch({ type: 'SET_AUTH', payload: { role: 'abrechnung', name } });
  }, []);

  const logoutAdmin = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    dispatch({ type: 'SET_AUTH', payload: { role: null, name: '' } });
  }, []);

  const setAktivePeriode = useCallback((id: string | null) => {
    dispatch({ type: 'SET_AKTIVE_PERIODE', payload: id });
  }, []);

  const isAdminAuthenticated = state.userRole !== null;

  return (
    <AppContext.Provider
      value={{
        ...state,
        isAdminAuthenticated,
        loginAdmin,
        loginAbrechnung,
        logoutAdmin,
        setAktivePeriode,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
