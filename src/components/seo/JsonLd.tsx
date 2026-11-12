/**
 * Renders a JSON-LD structured-data <script> tag. Server component.
 *
 * Some values now come from Content Studio (blog posts, page FAQs), i.e. text
 * typed by the team — so `<` is escaped: a string containing "</script>" can
 * then never close the tag early and inject markup. JSON stays valid
 * (\u003c is the same character to a JSON parser).
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
