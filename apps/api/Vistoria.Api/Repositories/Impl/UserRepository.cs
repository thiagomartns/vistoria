using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class UserRepository(AppDbContext db) : IUserRepository
{
    public Task<bool> EmailExistsAsync(string normalizedEmail, CancellationToken cancellationToken) =>
        db.Users.AnyAsync(u => u.Email == normalizedEmail, cancellationToken);

    public Task<User?> FindByEmailAsync(string normalizedEmail, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Email == normalizedEmail, cancellationToken);

    public async Task AddAsync(User user, CancellationToken cancellationToken)
    {
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException e) when (SqlErrors.IsUniqueViolation(e))
        {
            db.Entry(user).State = EntityState.Detached;
            throw new DuplicateEmailException(e);
        }
    }

    public Task UpdatePasswordHashAsync(User user, CancellationToken cancellationToken) =>
        db.Users.Where(u => u.Id == user.Id)
            .ExecuteUpdateAsync(u => u.SetProperty(x => x.PasswordHash, user.PasswordHash), cancellationToken);
}
