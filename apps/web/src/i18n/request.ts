import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "@/server/locale";
import { mergeMessages, type Locale } from "./locales";
import auth from "../../messages/en/auth.json";
import common from "../../messages/en/common.json";
import customers from "../../messages/en/customers.json";
import dashboard from "../../messages/en/dashboard.json";
import dispatch from "../../messages/en/dispatch.json";
import expenses from "../../messages/en/expenses.json";
import fieldwork from "../../messages/en/fieldwork.json";
import insights from "../../messages/en/insights.json";
import jobs from "../../messages/en/jobs.json";
import landing from "../../messages/en/landing.json";
import settings from "../../messages/en/settings.json";
import sla from "../../messages/en/sla.json";
import notifications from "../../messages/en/notifications.json";
import audit from "../../messages/en/audit.json";
import ai from "../../messages/en/ai.json";
import portal from "../../messages/en/portal.json";
import tour from "../../messages/en/tour.json";
import billing from "../../messages/en/billing.json";
import reports from "../../messages/en/reports.json";
import recurrences from "../../messages/en/recurrences.json";
import assistant from "../../messages/en/assistant.json";
import pay from "../../messages/en/pay.json";
import apiKeys from "../../messages/en/apiKeys.json";
import webhooks from "../../messages/en/webhooks.json";
import authId from "../../messages/id/auth.json";
import commonId from "../../messages/id/common.json";
import customersId from "../../messages/id/customers.json";
import dashboardId from "../../messages/id/dashboard.json";
import dispatchId from "../../messages/id/dispatch.json";
import expensesId from "../../messages/id/expenses.json";
import fieldworkId from "../../messages/id/fieldwork.json";
import insightsId from "../../messages/id/insights.json";
import jobsId from "../../messages/id/jobs.json";
import landingId from "../../messages/id/landing.json";
import settingsId from "../../messages/id/settings.json";
import slaId from "../../messages/id/sla.json";
import notificationsId from "../../messages/id/notifications.json";
import auditId from "../../messages/id/audit.json";
import aiId from "../../messages/id/ai.json";
import portalId from "../../messages/id/portal.json";
import tourId from "../../messages/id/tour.json";
import billingId from "../../messages/id/billing.json";
import reportsId from "../../messages/id/reports.json";
import recurrencesId from "../../messages/id/recurrences.json";
import assistantId from "../../messages/id/assistant.json";
import payId from "../../messages/id/pay.json";
import apiKeysId from "../../messages/id/apiKeys.json";
import webhooksId from "../../messages/id/webhooks.json";

// One file per namespace and language. English is complete; Bahasa Indonesia (SET-05, 0.4) is laid over it, so a
// key that isn't translated yet shows in English rather than as its raw key.
const en = {
  auth,
  common,
  customers,
  dashboard,
  dispatch,
  expenses,
  fieldwork,
  insights,
  jobs,
  landing,
  settings,
  sla,
  notifications,
  audit,
  ai,
  portal,
  tour,
  billing,
  reports,
  recurrences,
  assistant,
  pay,
  apiKeys,
  webhooks,
};
const id = {
  auth: authId,
  common: commonId,
  customers: customersId,
  dashboard: dashboardId,
  dispatch: dispatchId,
  expenses: expensesId,
  fieldwork: fieldworkId,
  insights: insightsId,
  jobs: jobsId,
  landing: landingId,
  settings: settingsId,
  sla: slaId,
  notifications: notificationsId,
  audit: auditId,
  ai: aiId,
  portal: portalId,
  tour: tourId,
  billing: billingId,
  reports: reportsId,
  recurrences: recurrencesId,
  assistant: assistantId,
  pay: payId,
  apiKeys: apiKeysId,
  webhooks: webhooksId,
};

const messages: Record<Locale, typeof en> = { en, id: mergeMessages(en, id) };

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: messages[locale], timeZone: "UTC" };
});
