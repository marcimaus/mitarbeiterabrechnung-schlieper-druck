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
  VariablerPeriodenZusatz,
  LohnkontoBuchung,
  Austraegerwechsel,
  StueckzahlAnpassung,
} from '../types';
import {
  mitarbeiterListener,
  tourenListener,
  teilgebieteListener,
  parameterListener,
  abrechnungsperiodenListener,
  variablePeriodenZusaetzeListener,
  lohnkontoBuchungenListener,
  austraegerwechselListener,
  stueckzahlAnpassungenListener,
} from '../lib/db';

// ---- State -------------------------------------------------

export type UserRole = 'admin' | 'abrechnung' | 'mitarbeiter' | null;

interface AppState {
  userRole: UserRole;
  adminName: string;
  /** Gesetzter Mitarbeiter-ID wenn als Mitarbeiter eingeloggt */
  mitarbeiterId: string | null;
  mitarbeiter: Mitarbeiter[];
  touren: Tour[];
  teilgebiete: Teilgebiet[];
  parameter: Parameter | null;
  abrechnungsperioden: Abrechnungsperiode[];
  variablePeriodenZusaetze: VariablerPeriodenZusatz[];
  lohnkontoBuchungen: LohnkontoBuchung[];
  austraegerwechsel: Austraegerwechsel[];
  stueckzahlAnpassungen: StueckzahlAnpassung[];
  aktivePeriodeId: string | null;
  isOnline: boolean;
  isLoading: boolean;
}

const initialState: AppState = {
  userRole: null,
  adminName: '',
  mitarbeiterId: null,
  mitarbeiter: [],
  touren: [],
  teilgebiete: [],
  parameter: null,
  abrechnungsperioden: [],
  variablePeriodenZusaetze: [],
  lohnkontoBuchungen: [],
  austraegerwechsel: [],
  stueckzahlAnpassungen: [],
  aktivePeriodeId: null,
  isOnline: navigator.onLine,
  isLoading: true,
};

// ---- Actions -----------------------------------------------

type Action =
  | { type: 'SET_AUTH'; payload: { role: UserRole; name: string; mitarbeiterId?: string } }
  | { type: 'SET_MITARBEITER'; payload: Mitarbeiter[] }
  | { type: 'SET_TOUREN'; payload: Tour[] }
  | { type: 'SET_TEILGEBIETE'; payload: Teilgebiet[] }
  | { type: 'SET_PARAMETER'; payload: Parameter | null }
  | { type: 'SET_ABRECHNUNGSPERIODEN'; payload: Abrechnungsperiode[] }
  | { type: 'SET_VARIABLE_PERIODEN_ZUSAETZE'; payload: VariablerPeriodenZusatz[] }
  | { type: 'SET_LOHNKONTO_BUCHUNGEN'; payload: LohnkontoBuchung[] }
  | { type: 'SET_AUSTRAEGERWECHSEL'; payload: Austraegerwechsel[] }
  | { type: 'SET_STUECKZAHL_ANPASSUNGEN'; payload: StueckzahlAnpassung[] }
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
        mitarbeiterId: action.payload.mitarbeiterId ?? null,
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
    case 'SET_VARIABLE_PERIODEN_ZUSAETZE':
      return { ...state, variablePeriodenZusaetze: action.payload };
    case 'SET_LOHNKONTO_BUCHUNGEN':
      return { ...state, lohnkontoBuchungen: action.payload };
    case 'SET_AUSTRAEGERWECHSEL':
      return { ...state, austraegerwechsel: action.payload };
    case 'SET_STUECKZAHL_ANPASSUNGEN':
      return { ...state, stueckzahlAnpassungen: action.payload };
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
  loginMitarbeiter: (id: string, name: string) => void;
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
      const parsed = JSON.parse(session) as { role: UserRole; name: string; mitarbeiterId?: string };
      return { ...initialState, userRole: parsed.role, adminName: parsed.name, mitarbeiterId: parsed.mitarbeiterId ?? null };
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
    const unsubZusaetze = variablePeriodenZusaetzeListener((list) => {
      dispatch({ type: 'SET_VARIABLE_PERIODEN_ZUSAETZE', payload: list });
    });
    const unsubLohnkonto = lohnkontoBuchungenListener((list) => {
      dispatch({ type: 'SET_LOHNKONTO_BUCHUNGEN', payload: list });
    });
    const unsubWechsel = austraegerwechselListener((list) => {
      dispatch({ type: 'SET_AUSTRAEGERWECHSEL', payload: list });
    });
    const unsubStueckzahl = stueckzahlAnpassungenListener((list) => {
      dispatch({ type: 'SET_STUECKZAHL_ANPASSUNGEN', payload: list });
    });

    return () => {
      unsubMitarbeiter();
      unsubTouren();
      unsubTeilgebiete();
      unsubParameter();
      unsubPerioden();
      unsubZusaetze();
      unsubLohnkonto();
      unsubWechsel();
      unsubStueckzahl();
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

  const loginMitarbeiter = useCallback((id: string, name: string) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: 'mitarbeiter', name, mitarbeiterId: id }));
    dispatch({ type: 'SET_AUTH', payload: { role: 'mitarbeiter', name, mitarbeiterId: id } });
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
        loginMitarbeiter,
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
