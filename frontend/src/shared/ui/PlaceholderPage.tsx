/**
 * Temporary F01 stub shown for routes whose pages belong to later tasks. It is
 * a navigation placeholder only: no data is fetched and no input is kept here.
 */
export function PlaceholderPage({
  title,
  note,
  notFound = false,
}: {
  title: string;
  note: string;
  notFound?: boolean;
}): React.ReactElement {
  return (
    <section aria-labelledby="placeholder-title">
      <h1 id="placeholder-title">{title}</h1>
      <p>{notFound ? "Маршрут не найден." : "Раздел будет реализован в следующей задаче."}</p>
      <p>{note}</p>
    </section>
  );
}
