import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { AccessMismatch } from "./AccessMismatch";
import { Loading, RequestError } from "../../web/ui";
import { portalPath, type PortalRole } from "./routing";
export { portalPath, safeReturnPath, type PortalRole } from "./routing";

export function ProtectedRoute({ role }: { role: PortalRole }) {
  const { user, checking, error, refresh } = useAuth();
  const location = useLocation();
  if (checking) return <Loading label="Verificando seu acesso…" full />;
  if (error) return <RequestError message={error} retry={() => void refresh()} />;
  if (!user) return <Navigate to={`${portalPath(role)}/login?retorno=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (user.role !== role) return <AccessMismatch expected={role} />;
  return <Outlet />;
}
