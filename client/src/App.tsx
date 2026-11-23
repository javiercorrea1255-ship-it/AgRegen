import React from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";
import { Toaster } from "@/components/ui/toaster";
import { Navbar } from "@/components/layout/navbar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { RecaptchaTokenProvider, RecaptchaNoopProvider } from "@/lib/recaptcha-context";
import { I18nProvider } from "@/lib/i18n-context";
import { ConnectivityProvider } from "@/lib/connectivity-context";
import { OfflineBanner } from "@/components/connectivity-indicator";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import ParcelDetail from "@/pages/parcel-detail";
import NewParcel from "@/pages/new-parcel";
import ParcelIndices from "@/pages/parcel-indices";
import ParcelClimate from "@/pages/parcel-climate";
import ParcelAlerts from "@/pages/parcel-alerts";
import ParcelCompare from "@/pages/parcel-compare";
import ParcelVariableManagement from "@/pages/parcel-variable-management";
import ParcelSamplingDesign from "@/pages/parcel-sampling-design";
import ParcelFieldCapture from "@/pages/parcel-field-capture";
import ParcelInterpolation from "@/pages/parcel-interpolation";
import ParcelZones from "@/pages/parcel-zones";
import ParcelPrescription from "@/pages/parcel-prescription";
import ParcelImport from "@/pages/parcel-import";
import ParcelSetup from "@/pages/parcel-setup";
import ParcelFieldLog from "@/pages/parcel-field-log";
import Community from "@/pages/community";
import Conferences from "@/pages/conferences";
import AuthPage from "@/pages/auth";
import AdminPanel from "@/pages/admin";
import About from "@/pages/about";
import Tutorial from "@/pages/tutorial";
import TechProfile from "@/pages/tech-profile";
import AmendmentsCalculator from "@/pages/amendments-calculator";
import Candidatura from "@/pages/candidatura";
import CandidaturaP2 from "@/pages/candidatura-p2";
import MexicoSoilMap from "@/pages/mexico-soil-map";
import NotFound from "@/pages/not-found";
import { PrivacyPolicyPage, TermsPage, DataDeletionPage } from "@/pages/legal-pages";

function LabImportRedirect() {
  const { data, isLoading } = useQuery<{ parcels: Array<{ id: string }> }>({
    queryKey: ["parcels"],
    queryFn: async () => {
      const res = await fetch("/api/parcels", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load parcels");
      return res.json();
    },
  });

  if (isLoading) return null;

  const firstParcelId = data?.parcels?.[0]?.id;
  if (firstParcelId) {
    return <Redirect to={`/parcel/${firstParcelId}/sampling/design`} />;
  }
  return <Redirect to="/dashboard" />;
}

function ProtectedRoute({ component: Component, allowWithoutTechProfile, ...rest }: any) {
  const { user, isLoading, needsTechProfile } = useAuth();
  const [location] = useLocation();

  if (isLoading) return null;

  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (needsTechProfile && !allowWithoutTechProfile && location !== "/tech-profile") {
    return <Redirect to="/tech-profile" />;
  }

  return <Component key={user.id} {...rest} />;
}

function Router() {
  return (
    <div className="min-h-screen flex flex-col font-sans">
      <OfflineBanner />
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/auth" component={AuthPage} />
          
          <Route path="/dashboard">
             <ProtectedRoute component={Dashboard} />
          </Route>

          <Route path="/parcel/new">
            <ProtectedRoute component={NewParcel} />
          </Route>
          
          <Route path="/parcel/:id/indices">
            {(params) => <ProtectedRoute component={ParcelIndices} params={params} />}
          </Route>

          <Route path="/parcel/:id/climate">
            {(params) => <ProtectedRoute component={ParcelClimate} params={params} />}
          </Route>

          <Route path="/parcel/:id/alerts">
            {(params) => <ProtectedRoute component={ParcelAlerts} params={params} />}
          </Route>

          <Route path="/parcel/:id/compare">
            {(params) => <ProtectedRoute component={ParcelCompare} params={params} />}
          </Route>

          <Route path="/parcel/:id/variable-management">
            {(params) => <ProtectedRoute component={ParcelVariableManagement} params={params} />}
          </Route>

          <Route path="/parcel/:id/sampling/design">
            {(params) => <ProtectedRoute component={ParcelSamplingDesign} params={params} />}
          </Route>

          <Route path="/parcel/:id/sampling/capture">
            {(params) => <ProtectedRoute component={ParcelFieldCapture} params={params} />}
          </Route>

          <Route path="/parcel/:id/sampling/maps">
            {(params) => <ProtectedRoute component={ParcelInterpolation} params={params} />}
          </Route>

          <Route path="/parcel/:id/import">
            {(params) => <ProtectedRoute component={ParcelImport} params={params} />}
          </Route>

          <Route path="/parcel/:id/zones">
            {(params) => <ProtectedRoute component={ParcelZones} params={params} />}
          </Route>

          <Route path="/parcel/:id/prescription">
            {(params) => <ProtectedRoute component={ParcelPrescription} params={params} />}
          </Route>

          <Route path="/parcel/:id/enmiendas">
            {(params) => <ProtectedRoute component={AmendmentsCalculator} params={params} />}
          </Route>

          <Route path="/parcel/:id/setup">
            {(params) => <ProtectedRoute component={ParcelSetup} params={params} />}
          </Route>

          <Route path="/parcel/:id/field-log">
            {(params) => <ProtectedRoute component={ParcelFieldLog} params={params} />}
          </Route>

          <Route path="/parcel/:id">
            {(params) => <ProtectedRoute key={params.id} component={ParcelDetail} params={params} />}
          </Route>

          <Route path="/lab-import">
            <ProtectedRoute component={LabImportRedirect} />
          </Route>

          <Route path="/mapa-suelo-mexico" component={MexicoSoilMap} />

          <Route path="/community" component={Community} />
          <Route path="/conferences" component={Conferences} />
          <Route path="/conferences/:id" component={Conferences} />
          <Route path="/about" component={About} />
          <Route path="/tutorial" component={Tutorial} />
          <Route path="/politica-de-privacidad" component={PrivacyPolicyPage} />
          <Route path="/terminos-y-condiciones" component={TermsPage} />
          <Route path="/eliminacion-de-datos" component={DataDeletionPage} />
          <Route path="/candidatura" component={Candidatura} />
          <Route path="/candidatura-p2" component={CandidaturaP2} />

          <Route path="/tech-profile">
            <ProtectedRoute component={TechProfile} allowWithoutTechProfile />
          </Route>

          <Route path="/admin">
            <ProtectedRoute component={AdminPanel} />
          </Route>
          
          <Route component={NotFound} />
        </Switch>
      </main>
      <Toaster />
    </div>
  );
}

function ReCaptchaWrapper({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["recaptcha-config"],
    queryFn: async () => {
      const res = await fetch("/api/config/recaptcha");
      if (!res.ok) return { siteKey: "" };
      return res.json();
    },
    staleTime: Infinity,
  });

  if (!data?.siteKey) {
    return (
      <RecaptchaNoopProvider>
        {children}
      </RecaptchaNoopProvider>
    );
  }

  return (
    <GoogleReCaptchaProvider
      reCaptchaKey={data.siteKey}
      language="es"
      scriptProps={{ async: true, defer: true }}
    >
      <RecaptchaTokenProvider>
        {children}
      </RecaptchaTokenProvider>
    </GoogleReCaptchaProvider>
  );
}

function App() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <ConnectivityProvider>
          <ReCaptchaWrapper>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </ReCaptchaWrapper>
        </ConnectivityProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}

export default App;
