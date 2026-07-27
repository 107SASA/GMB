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
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
