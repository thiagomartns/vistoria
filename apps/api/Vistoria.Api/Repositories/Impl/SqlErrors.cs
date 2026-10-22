using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Vistoria.Api.Repositories.Impl;

internal static class SqlErrors
{
    // Violação de índice único (2601) ou de PK/constraint unique (2627) no SQL Server.
    private static readonly int[] UniqueViolations = [2601, 2627];

    public static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException sql && UniqueViolations.Contains(sql.Number);
}
