import { MetadataRoute } from "next";

const BASE_URL = "https://growwmatics.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/admin/",
          "/dashboard",
          "/dashboard/",
          "/api/",
          "/onboarding",
          "/demo-success",
          "/reports/",
          "/login",
          "/admin-login",
          "/forgot-password",
          "/verify",
          // Personal / one-time pages: links sent to a single person, never
          // content for search (a crawler would only see an empty state).
          "/free-report/result",
          "/checkout",
          "/connect-google/",
          "/print/",
          "/review/",
          "/go/",
          "/verify-phone",
          // Content Studio (marketing team's editor) and its draft previews.
          "/studio",
          "/admin-invite/",
          "/partner",
          "/partner-login",
          "/partner-invite/",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
