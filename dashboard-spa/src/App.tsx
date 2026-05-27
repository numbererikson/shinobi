import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { ProjectLayout } from './pages/ProjectLayout';
import { Kanban } from './pages/project/Kanban';
import { Subtasks } from './pages/project/Subtasks';
import { Decisions } from './pages/project/Decisions';
import { Drafts } from './pages/project/Drafts';
import { DeadEnds } from './pages/project/DeadEnds';
import { Notes } from './pages/project/Notes';
import { Plans } from './pages/project/Plans';
import { Context } from './pages/project/Context';
import { Timeline } from './pages/project/Timeline';
import { Analytics } from './pages/project/Analytics';
import { ProjectSessions } from './pages/project/Sessions';
import { AllSessions } from './pages/Sessions';
import { SessionDetail } from './pages/SessionDetail';
import { Settings } from './pages/Settings';
import { Voice } from './pages/Voice';
import { Approvals } from './pages/Approvals';
import { Push } from './pages/Push';
import { Relay } from './pages/Relay';
import { Plugins } from './pages/Plugins';
import { Telemetry } from './pages/Telemetry';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/voice" element={<Voice />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/push" element={<Push />} />
          <Route path="/relay" element={<Relay />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="/telemetry" element={<Telemetry />} />
          <Route path="/sessions" element={<AllSessions />} />
          <Route path="/sessions/:sessionId" element={<SessionDetail />} />
          <Route path="/projects/:id" element={<ProjectLayout />}>
            <Route index element={<Kanban />} />
            <Route path="subtasks" element={<Subtasks />} />
            <Route path="decisions" element={<Decisions />} />
            <Route path="decision-drafts" element={<Drafts />} />
            <Route path="dead-ends" element={<DeadEnds />} />
            <Route path="notes" element={<Notes />} />
            <Route path="plans" element={<Plans />} />
            <Route path="context" element={<Context />} />
            <Route path="sessions" element={<ProjectSessions />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="analytics" element={<Analytics />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
