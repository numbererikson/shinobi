export const PRIORITY_ORDER_SQL = `CASE priority
  WHEN 'urgent' THEN 4
  WHEN 'high'   THEN 3
  WHEN 'medium' THEN 2
  WHEN 'low'    THEN 1
  ELSE 0
END`;
