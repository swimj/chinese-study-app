import { Fragment, useEffect, useState } from 'react';
import type { ReviewItem } from '../types';
import type { InspectableRow } from '../features/words/words-page-model';

export function WordsPage({
  rows,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPreviousPage,
  onNextPage,
}: {
  rows: InspectableRow[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const startIndex = totalItems === 0 ? 0 : currentPage * pageSize + 1;
  const endIndex = Math.min(totalItems, (currentPage + 1) * pageSize);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedRowIds((current) => {
      const next: Record<string, boolean> = {};

      for (const row of rows) {
        if (current[row.id]) {
          next[row.id] = true;
        }
      }

      return next;
    });
  }, [rows]);

  function toggleRow(rowId: string) {
    setExpandedRowIds((current) => ({
      ...current,
      [rowId]: !current[rowId],
    }));
  }

  return (
    <section className="words-page">
      <header className="header">
        <div>
          <h1 className="title">Words</h1>
          <p className="subtitle">Inspect all words currently in learning or review, plus their scheduling metadata.</p>
        </div>
        <div className="pagination-summary">
          <span className="badge">Showing {startIndex}-{endIndex} of {totalItems}</span>
        </div>
      </header>

      <div className="panel">
        <div className="pagination-bar">
          <p className="notes">
            Page {totalItems === 0 ? 0 : currentPage + 1} of {totalPages}
          </p>
          <div className="pagination-actions">
            <button type="button" onClick={onPreviousPage} disabled={currentPage === 0}>
              Previous
            </button>
            <button type="button" onClick={onNextPage} disabled={currentPage >= totalPages - 1 || totalItems === 0}>
              Next
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="notes">No words are currently in learning or review.</p>
        ) : (
          <div className="table-shell">
            <table className="words-table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Status</th>
                  <th>Next scheduled date</th>
                  <th>Direction</th>
                  <th>Interval</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = Boolean(expandedRowIds[row.id]);

                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={`table-row ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => toggleRow(row.id)}
                      >
                        <td>
                          <div className="table-word-cell">
                            <strong>{row.word.hanzi}</strong>
                            <span>{row.word.pinyin}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`status-pill status-${row.status}`}>{row.status}</span>
                        </td>
                        <td>{formatScheduledValue(row)}</td>
                        <td>{row.direction ? formatDirection(row.direction) : 'N/A'}</td>
                        <td>{row.intervalHours !== null ? `${row.intervalHours}h` : 'N/A'}</td>
                      </tr>
                      {isExpanded ? (
                        <tr className="detail-row">
                          <td colSpan={5}>
                            <div className="detail-panel">
                              <div className="word-record-header">
                                <div>
                                  <h2>{row.word.hanzi}</h2>
                                  <p className="notes">{row.word.pinyin} · {row.word.meaning}</p>
                                  {row.word.personalNotes.trim().length > 0 ? (
                                    <p className="notes">Notes: {row.word.personalNotes}</p>
                                  ) : null}
                                </div>
                                <span className={`status-pill status-${row.status}`}>{row.status}</span>
                              </div>

                              <dl className="metadata-grid">
                                <div>
                                  <dt>Word ID</dt>
                                  <dd>{row.word.id}</dd>
                                </div>
                                <div>
                                  <dt>Priority</dt>
                                  <dd>{row.word.priority}</dd>
                                </div>
                                <div>
                                  <dt>Learning streak</dt>
                                  <dd>{row.word.learningStreak}</dd>
                                </div>
                                <div>
                                  <dt>Created</dt>
                                  <dd>{formatDateTime(row.word.createdAt)}</dd>
                                </div>
                                <div>
                                  <dt>Last learning success</dt>
                                  <dd>{formatDate(row.word.lastLearningSuccessOn)}</dd>
                                </div>
                                <div>
                                  <dt>Last learning covered</dt>
                                  <dd>{formatDate(row.word.lastLearningCoveredOn)}</dd>
                                </div>
                              </dl>

                              {row.reviewItem ? (
                                <div className="review-items-section">
                                  <h3>Selected review item</h3>
                                  <dl className="metadata-grid compact">
                                    <div>
                                      <dt>Review item ID</dt>
                                      <dd>{row.reviewItem.id}</dd>
                                    </div>
                                    <div>
                                      <dt>Direction</dt>
                                      <dd>{formatDirection(row.reviewItem.direction)}</dd>
                                    </div>
                                    <div>
                                      <dt>Interval</dt>
                                      <dd>{row.reviewItem.intervalHours}h</dd>
                                    </div>
                                    <div>
                                      <dt>Ease factor</dt>
                                      <dd>{row.reviewItem.easeFactor.toFixed(2)}</dd>
                                    </div>
                                    <div>
                                      <dt>Last reviewed</dt>
                                      <dd>{formatDateTime(row.reviewItem.lastReviewedAt)}</dd>
                                    </div>
                                    <div>
                                      <dt>Next due</dt>
                                      <dd>{formatDateTime(row.reviewItem.nextDueAt)}</dd>
                                    </div>
                                  </dl>
                                </div>
                              ) : null}

                              <div className="review-items-section">
                                <h3>All review directions</h3>
                                {row.reviewItems.length === 0 ? (
                                  <p className="notes">No review items found for this word.</p>
                                ) : (
                                  <div className="review-items-grid">
                                    {row.reviewItems.map((item) => (
                                      <div key={item.id} className="review-item-card">
                                        <div className="review-item-topline">
                                          <strong>{formatDirection(item.direction)}</strong>
                                          <span className="badge">{item.id}</span>
                                        </div>
                                        <dl className="metadata-grid compact">
                                          <div>
                                            <dt>Interval</dt>
                                            <dd>{item.intervalHours}h</dd>
                                          </div>
                                          <div>
                                            <dt>Ease factor</dt>
                                            <dd>{item.easeFactor.toFixed(2)}</dd>
                                          </div>
                                          <div>
                                            <dt>Last reviewed</dt>
                                            <dd>{formatDateTime(item.lastReviewedAt)}</dd>
                                          </div>
                                          <div>
                                            <dt>Next due</dt>
                                            <dd>{formatDateTime(item.nextDueAt)}</dd>
                                          </div>
                                        </dl>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not scheduled';
  }

  return new Date(value).toLocaleString();
}

function formatDirection(direction: ReviewItem['direction']) {
  return direction === 'forward' ? 'Hanzi → Meaning' : 'Meaning → Hanzi';
}

function formatScheduledValue(row: InspectableRow) {
  if (row.status === 'learning') {
    return row.word.lastLearningCoveredOn ? formatDate(row.word.lastLearningCoveredOn) : 'Not yet covered';
  }

  return formatDateTime(row.nextScheduledAt);
}
