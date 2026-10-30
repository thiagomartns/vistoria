using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class RefreshTokenRepository(AppDbContext db) : IRefreshTokenRepository
{
    public async Task AddAsync(RefreshToken token, CancellationToken cancellationToken)
    {
        db.RefreshTokens.Add(token);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        finally
        {
            db.Entry(token).State = EntityState.Detached;
        }
    }

    public Task<RefreshToken?> FindByHashAsync(byte[] tokenHash, CancellationToken cancellationToken) =>
        db.RefreshTokens.AsNoTracking().SingleOrDefaultAsync(t => t.TokenHash == tokenHash, cancellationToken);

    public async Task<bool> TryMarkReplacedAsync(Guid id, DateTimeOffset now, CancellationToken cancellationToken) =>
        await db.RefreshTokens
            .Where(t => t.Id == id && t.ReplacedAt == null && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ReplacedAt, now), cancellationToken) == 1;

    public Task RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken cancellationToken) =>
        db.RefreshTokens
            .Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), cancellationToken);
}
