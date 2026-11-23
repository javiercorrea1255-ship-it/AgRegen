import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Network, Menu, LogOut, User as UserIcon, Shield, Globe, GraduationCap, Info, Camera, BookOpen, Map as MapIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth-context";
import { useI18n, localeNames, localeFlags } from "@/lib/i18n-context";
import type { Locale } from "@/lib/translations";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logoImage from "@/assets/logo-agregen.png";
import { InstallPwaButton } from "@/components/install-pwa-button";
import { ConnectivityIndicator } from "@/components/connectivity-indicator";
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function Navbar() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout, isAdmin } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const isLanding = location === "/";
  const isAuthPage = location === "/auth";
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarVersion, setAvatarVersion] = useState(() => Date.now());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("avatar", file);
    try {
      const res = await fetch("/api/auth/avatar", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setAvatarVersion(Date.now());
      toast({ title: t("nav.avatarUpdated") });
    } catch {
      toast({ title: t("nav.avatarError"), variant: "destructive" });
    }
    e.target.value = "";
  };

  if (isAuthPage) return null;

  const navLinks = [
    { href: "/dashboard", label: t("nav.platform"), icon: LayoutDashboard },
    { href: "/conferences", label: t("nav.conferences"), icon: GraduationCap },
    { href: "/community", label: t("nav.community"), icon: Network },
    { href: "/tutorial", label: "Tutorial", icon: BookOpen },
    { href: "/mapa-suelo-mexico", label: "Atlas de Suelos", icon: MapIcon },
    { href: "/about", label: t("nav.about"), icon: Info },
    ...(isAdmin ? [{ href: "/admin", label: t("nav.admin"), icon: Shield }] : []),
  ];

  return (
    <nav className={`w-full z-50 transition-all duration-300 ${isLanding ? 'fixed top-0 bg-white text-foreground border-b shadow-lg' : 'sticky top-0 bg-white border-b text-foreground shadow-sm'}`}>
      <div className="container mx-auto px-4 h-14 md:h-20 flex items-center justify-between">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <img src={logoImage} alt="AgRegen 5.0" className="h-10 md:h-20 w-auto drop-shadow-lg" />
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <span className={`text-sm font-medium hover:text-primary transition-colors cursor-pointer ${location === link.href ? 'text-primary font-semibold' : ''}`}>
                {link.label}
              </span>
            </Link>
          ))}

          <ConnectivityIndicator />
          <InstallPwaButton />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 text-sm" data-testid="btn-language-selector">
                <Globe className="h-4 w-4" />
                <span>{localeFlags[locale]}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(localeNames) as Locale[]).map((loc) => (
                <DropdownMenuItem
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className={locale === loc ? "bg-primary/10 font-semibold" : ""}
                  data-testid={`btn-lang-${loc}`}
                >
                  <span className="mr-2">{localeFlags[loc]}</span>
                  {localeNames[loc]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    {user.avatarUrl && <AvatarImage src={`${user.avatarUrl}?v=${avatarVersion}`} alt={user.name} />}
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {user.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => avatarInputRef.current?.click()}>
                  <Camera className="mr-2 h-4 w-4" />
                  <span>{t("nav.changePhoto")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t("nav.logout")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </DropdownMenu>
          ) : (
            <Button variant={isLanding ? "secondary" : "default"} size="sm" asChild>
              <Link href="/auth">{t("nav.login")}</Link>
            </Button>
          )}
        </div>

        {/* Mobile nav */}
        <div className="md:hidden flex items-center gap-1">
          <ConnectivityIndicator compact />
          <InstallPwaButton variant="compact" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-foreground" data-testid="btn-language-mobile">
                <Globe className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(localeNames) as Locale[]).map((loc) => (
                <DropdownMenuItem
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className={locale === loc ? "bg-primary/10 font-semibold" : ""}
                >
                  <span className="mr-2">{localeFlags[loc]}</span>
                  {localeNames[loc]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-foreground" data-testid="btn-mobile-menu">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] p-0">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <img src={logoImage} alt="AgRegen" className="h-8 w-auto" />
                <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* User info if logged in */}
              {user && (
                <div className="flex items-center gap-3 px-5 py-4 bg-muted/40 border-b">
                  <Avatar className="h-10 w-10">
                    {user.avatarUrl && <AvatarImage src={`${user.avatarUrl}?v=${avatarVersion}`} alt={user.name} />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                      {user.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                </div>
              )}

              {/* Nav links */}
              <nav className="flex flex-col py-2">
                {navLinks.map((link) => {
                  const Icon = link.icon;
                  const active = location === link.href;
                  return (
                    <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}>
                      <div className={`flex items-center gap-3 px-5 py-3.5 text-sm font-medium transition-colors active:bg-muted
                        ${active ? "text-primary bg-primary/5 border-r-2 border-primary" : "text-foreground hover:bg-muted/60"}`}>
                        <Icon className={`h-5 w-5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                        {link.label}
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {/* Bottom actions */}
              <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-background space-y-2">
                {user ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => { avatarInputRef.current?.click(); setMobileOpen(false); }}
                    >
                      <Camera className="h-4 w-4" /> Cambiar foto
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={() => { logout(); setMobileOpen(false); }}
                    >
                      <LogOut className="h-4 w-4" /> {t("nav.logout")}
                    </Button>
                  </>
                ) : (
                  <Button asChild className="w-full" onClick={() => setMobileOpen(false)}>
                    <Link href="/auth">{t("nav.login")}</Link>
                  </Button>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
