/**
 * Renders a JSON-LD structured-data <script> tag. Server component — data is
 * always our own server-constructed object (see src/lib/seoSchemas.ts),
 * never raw user input, so JSON.stringify → dangerouslySetInnerHTML here is
 * safe (standard Next.js structured-data pattern).
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
