import { getRequestConfig } from "next-intl/server";
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

// English ships in 0.1; Bahasa Indonesia arrives with SET-05 in 0.4. Each namespace lives in its own file.
const messages = {
  en: {
    common,
    auth,
    jobs,
    customers,
    settings,
    landing,
    dispatch,
    fieldwork,
    expenses,
    dashboard,
    insights,
  },
};

export default getRequestConfig(async () => {
  const locale = "en";
  return { locale, messages: messages[locale], timeZone: "UTC" };
});
