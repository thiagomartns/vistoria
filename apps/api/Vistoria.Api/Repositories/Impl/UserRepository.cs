using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class UserRepository(AppDbContext db) : IUserRepository
{
    // Violação de índice único (2601) ou de constraint unique (2627) no SQL Server.
    private static readonly int[] UniqueViolations = [2601, 2627];

    public Task<bool> EmailExistsAsync(string normalizedEmail, CancellationToken cancellationToken) =>
        db.Users.AnyAsync(u => u.Email == normalizedEmail, cancellationToken);

    public async Task AddAsync(User user, CancellationToken cancellationToken)
    {
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException e) when (e.InnerException is SqlException sql && UniqueViolations.Contains(sql.Number))
        {
            db.Entry(user).State = EntityState.Detached;
            throw new DuplicateEmailException(e);
        }
    }
}
