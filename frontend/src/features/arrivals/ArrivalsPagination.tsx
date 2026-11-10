/**
 * ArrivalsPagination (DR3, spec 13): centered server pagination with page
 * numbers whenever more than one page exists. Arrows keep the accessible
 * names «Предыдущая страница»/«Следующая страница».
 */
import { Icon } from "../../shared/ui/Icon";

export interface ArrivalsPaginationProps {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}

function pageWindow(page: number, pageCount: number): number[] {
  const from = Math.max(1, Math.min(page - 2, pageCount - 4));
  const to = Math.min(pageCount, from + 4);
  const numbers: number[] = [];
  for (let index = from; index <= to; index += 1) numbers.push(index);
  return numbers;
}

export function ArrivalsPagination({ page, pageCount, onPage }: ArrivalsPaginationProps): React.ReactElement {
  if (pageCount <= 1) return <nav className="arrivals-pagination" aria-label="Страницы списка поступлений" />;
  return (
    <nav className="arrivals-pagination" aria-label="Страницы списка поступлений">
      <button
        type="button"
        className="page-arrow"
        aria-label="Предыдущая страница"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <Icon name="chevron-left" />
      </button>
      {pageWindow(page, pageCount).map((number) => (
        <button
          key={number}
          type="button"
          className="page-button"
          aria-current={number === page ? "page" : undefined}
          onClick={() => onPage(number)}
        >
          {number}
        </button>
      ))}
      <button
        type="button"
        className="page-arrow"
        aria-label="Следующая страница"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        <Icon name="chevron-right" />
      </button>
    </nav>
  );
}
