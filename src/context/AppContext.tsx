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

interface AppState {
  isAdminAuthenticated: boolean;
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
  isAdminAuthenticated: false,
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
  | { type: 'SET_ADMIN_AUTH'; payload: { authenticated: boolean; name: string } }
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
    case 'SET_ADMIN_AUTH':
      return {
        ...state,
        isAdminAuthenticated: action.payload.authenticated,
        adminName: action.payload.name,
      };
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
  loginAdmin: (name: string) => void;
  logoutAdmin: () => void;
  setAktivePeriode: (id: string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// ---- Provider ----------------------------------------------

const ADMIN_SESSION_KEY = 'adminSession';

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState, () => {
    // Admin-Session aus sessionStorage wiederherstellen
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (session) {
      const { name } = JSON.parse(session);
      return {
        ...initialState,
        isAdminAuthenticated: true,
        adminName: name,
      };
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
      if (loaded >= 4) {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
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
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ name }));
    dispatch({ type: 'SET_ADMIN_AUTH', payload: { authenticated: true, name } });
  }, []);

  const logoutAdmin = useCallback(() => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    dispatch({ type: 'SET_ADMIN_AUTH', payload: { authenticated: false, name: '' } });
  }, []);

  const setAktivePeriode = useCallback((id: string | null) => {
    dispatch({ type: 'SET_AKTIVE_PERIODE', payload: id });
  }, []);

  return (
    <AppContext.Provider
      value={{ ...state, loginAdmin, logoutAdmin, setAktivePeriode }}
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
