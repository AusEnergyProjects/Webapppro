import type { BusinessReport } from "./trade-business-reports.ts";

export type HomeJobReference = { id: string; workNumber: string; title: string; protected: boolean };
export type HomeAppointment = {
  id: string; appointmentType: string; title: string; startsAt: string; endsAt: string;
  assigneeLabel: string; status: string; job: HomeJobReference;
};
export type HomeTask = { id: string; title: string; dueAt: string; status: string; job: HomeJobReference };
export type HomeIssue = { id: string; body: string; createdAt: string; job: HomeJobReference };
export type HomeWorkloadWeek = {
  weekStart: string; weekEnd: string; jobs: number; visits: number; bookedMinutes: number; missingDurations: number;
};
export type HomeDashboard = {
  generatedAt: string; today: string; timeZone: string;
  metrics: {
    openJobs: number; waitingJobs: number; awaitingSchedule: number; todayJobs: number; todayVisits: number;
    thisWeekJobs: number; thisWeekVisits: number; nextWeekJobs: number; nextWeekVisits: number;
    overdueTasks: number; openIssues: number;
  };
  /** Includes completed visits in the current week; cancelled and imported visits are excluded. */
  workload: HomeWorkloadWeek[];
  workStages: Record<string, number>;
  /** Preview lists are capped; metrics and workload are full database aggregates. */
  upcomingAppointments: HomeAppointment[]; overdueTasks: HomeTask[]; openIssues: HomeIssue[];
  /** Period invoicing and completed-job profitability retain their separate report accounting bases. */
  financial: BusinessReport | null;
};
export type HomeDashboardResponse = { ok: true; dashboard: HomeDashboard };
