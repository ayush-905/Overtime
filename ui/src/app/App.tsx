// The dashboard: the sidebar (or, compact, a header and a tab bar along the foot)
// around the section on screen, fed live by the server. Compact is a phone, the
// Mac app's menu bar popover, or /mini.

import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType } from 'react';
import { WifiOff } from 'lucide-react';
import { TITLES } from '@/lib/nav';
import { connectLive, needsCount, useLive } from '@/data/live';
import { startLimits } from '@/data/limits';
import { Overview } from '@/pages/Overview';
import { Skeleton } from '@/components/Bits';
import { Card } from '@/components/Card';

// The Overview comes with the page; the other sections load the first time they're opened,
// so the window and the popover start sooner.
const section = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Sessions = section(() => import('@/pages/Sessions'), 'Sessions');
const Projects = section(() => import('@/pages/Projects'), 'Projects');
const Usage = section(() => import('@/pages/Usage'), 'Usage');
const Cost = section(() => import('@/pages/Cost'), 'Cost');
const Agents = section(() => import('@/pages/Agents'), 'Agents');
const You = section(() => import('@/pages/You'), 'You');
const Settings = section(() => import('@/pages/Settings'), 'Settings');
const Parts = section(() => import('@/pages/Parts'), 'Parts');

function Loading() {
  return (
    <Card aria-busy="true">
      <Skeleton lines={5} />
    </Card>
  );
}
import { CommandDialog, useCommand } from './CommandDialog';
import { useAlerts } from './alerts';
import { useGlance } from './glance';
import { ResetDialog, useReset } from './ResetDialog';
import { ArrangeDialog, useArrange } from '@/components/PageGrid';
import { ProjectDialog, useProjectDialog } from './ProjectDialog';
import { CompareDialog, useCompare } from './CompareDialog';
import { MAIN, startRouter, useRoute, type RoutePage } from './router';
import { restoreScroll, startBack } from './back';
import { useUi } from './ui';
import { Sidebar } from './Sidebar';
import { CompactHeader, TabBar } from './Compact';
import { Palette } from './Palette';
import { KeysDialog, useShortcuts } from './keys';
import { TooltipLayer } from './Tooltip';
import { Toasts } from './toasts';
import { SessionPanel, usePanelDocked } from './SessionPanel';
import { useCompact } from './layout';
import { CustomizeDialog } from '@/cards/Customize';
import { DigestDialog } from '@/cards/Digest';
import { useExpand } from '@/cards/Expand';
import { inPopover } from '@/data/desktop';

/** Back closes what's over the page first: a dialog, or a session's panel floating over it. */
function closeOver() {
  const ui = useUi.getState();
  const expand = useExpand.getState();
  if (ui.paletteOpen) ui.setPaletteOpen(false);
  else if (ui.keysOpen) ui.setKeysOpen(false);
  else if (ui.digest != null) ui.setDigest(null);
  else if (ui.customizing) ui.setCustomizing(false);
  else if (useProjectDialog.getState().name) useProjectDialog.getState().close();
  else if (useCompare.getState().open) useCompare.getState().close();
  else if (useArrange.getState().arranging) useArrange.getState().open(null);
  else if (useCommand.getState().group) useCommand.getState().close();
  else if (useReset.getState().mode) useReset.getState().close();
  else if (expand.card) expand.set(null);
  else if (ui.session && !(ui.docked && matchMedia('(min-width: 1100px)').matches && !inPopover)) ui.closeSession();
  else return false;
  return true;
}

let started = false;
/** Follow the server, the plan limits and the address. Before the first render. */
export function startApp() {
  if (started) return;
  started = true;
  connectLive();
  startLimits();
  startRouter();
  startBack(closeOver);
}

function PageFor({ page }: { page: RoutePage }) {
  if (page === 'overview') return <Overview />;
  if (page === 'settings') return <Settings />;
  if (page === 'parts') return <Parts />;
  if (page === 'sessions') return <Sessions />;
  if (page === 'projects') return <Projects />;
  if (page === 'usage') return <Usage />;
  if (page === 'cost') return <Cost />;
  if (page === 'agents') return <Agents />;
  return <You />;
}

/** Only says something when the live connection drops, since the numbers stop updating. */
function Offline() {
  const connected = useLive((s) => s.connected);
  if (connected) return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-row border border-warn-line bg-warn-soft px-3.5 py-2.5 text-detail text-warn">
      <WifiOff size={15} strokeWidth={1.9} aria-hidden />
      Lost touch with Overtime's server. The figures stop updating until it's back; trying again.
    </p>
  );
}

export function App() {
  useShortcuts();
  useAlerts(MAIN);
  useGlance();
  const page = useRoute((s) => s.page);
  const session = useRoute((s) => s.session);
  const compact = useCompact();
  const beside = usePanelDocked();
  const needs = useLive((s) => needsCount(s.snap));

  useEffect(() => {
    document.documentElement.classList.toggle('compact', compact);
  }, [compact]);

  // The count shows in the tab strip, even in a background tab.
  useEffect(() => {
    document.title = `${needs ? `(${needs}) ` : ''}${page !== 'overview' && page !== 'parts' ? `${TITLES[page]} · ` : ''}Overtime`;
  }, [needs, page]);

  // Back or forward to a page: where you were on it.
  useLayoutEffect(() => {
    restoreScroll();
  }, [page]);

  // #session=<id> in the address opens its panel over the page you were on.
  useEffect(() => {
    if (!session) return;
    useRoute.getState().sessionHandled();
    useUi.getState().openSession(session);
  }, [session]);

  // The page is a container: its cards lay out by the room they have, which a docked panel takes some of.
  const content = (
    <div className="@container min-w-0 flex flex-col gap-[var(--page-gap)]">
      <Offline />
      <Suspense fallback={<Loading />}>
        <PageFor page={page} />
      </Suspense>
    </div>
  );

  return (
    <>
      {compact ? (
        <div className="compact-shell min-h-dvh min-w-0 pb-[var(--tabbar-h)]">
          <CompactHeader />
          <main className="min-w-0 px-3.5 pb-6 pt-2">{content}</main>
          <TabBar />
        </div>
      ) : (
        <div className="flex min-h-dvh">
          <Sidebar />
          <main className="min-w-0 grow px-10 pb-10 pt-7 max-[1100px]:px-6">{content}</main>
          {beside && <SessionPanel />}
        </div>
      )}
      {!beside && <SessionPanel />}
      <CustomizeDialog />
      <DigestDialog />
      <ProjectDialog />
      <CompareDialog />
      <ArrangeDialog />
      <CommandDialog />
      <ResetDialog />
      <Palette />
      <KeysDialog />
      <Toasts />
      <TooltipLayer />
    </>
  );
}
