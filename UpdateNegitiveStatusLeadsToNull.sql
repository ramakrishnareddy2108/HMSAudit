DECLARE @RunDate DATETIME2 = DATEADD(DAY, -1, CAST(GETDATE() AS DATE));

-- ===============================
-- ResponseId = 1444
-- ===============================
UPDATE LeadMaster
SET
    ResponseId = NULL,
    NegativeResponseUpdatedate = NULL,
    ModifiedDate = NULL
WHERE Id IN
(
    SELECT lm.Id
    FROM LeadMaster lm
    JOIN LeadUser lu ON lm.Leaduserid = lu.Id
    WHERE lm.NegativeResponseUpdatedate > @RunDate
    AND lm.LeadJobId IN
    (
        SELECT LeadJobId
        FROM LeadMaster
        WHERE ThirdRunScheduledAt > @RunDate
          AND isDeleted = 0
        GROUP BY LeadJobId
        HAVING COUNT(*) = COUNT(CASE WHEN ResponseId = 1444 THEN 1 END)
    )
);

-- ===============================
-- ResponseId = 1445
-- ===============================
UPDATE LeadMaster
SET
    ResponseId = NULL,
    NegativeResponseUpdatedate = NULL,
    ModifiedDate = NULL
WHERE Id IN
(
    SELECT lm.Id
    FROM LeadMaster lm
    JOIN LeadUser lu ON lm.Leaduserid = lu.Id
    WHERE lm.NegativeResponseUpdatedate > @RunDate
    AND lm.LeadJobId IN
    (
        SELECT LeadJobId
        FROM LeadMaster
        WHERE ThirdRunScheduledAt > @RunDate
          AND isDeleted = 0
        GROUP BY LeadJobId
        HAVING COUNT(*) = COUNT(CASE WHEN ResponseId = 1445 THEN 1 END)
    )
);

-- ===============================
-- ResponseId = 2671
-- ===============================
UPDATE LeadMaster
SET
    ResponseId = NULL,
    NegativeResponseUpdatedate = NULL,
    ModifiedDate = NULL
WHERE Id IN
(
    SELECT lm.Id
    FROM LeadMaster lm
    JOIN LeadUser lu ON lm.Leaduserid = lu.Id
    WHERE lm.NegativeResponseUpdatedate > @RunDate
    AND lm.LeadJobId IN
    (
        SELECT LeadJobId
        FROM LeadMaster
        WHERE ThirdRunScheduledAt > @RunDate
          AND isDeleted = 0
        GROUP BY LeadJobId
        HAVING COUNT(*) = COUNT(CASE WHEN ResponseId = 2671 THEN 1 END)
    )
);


 