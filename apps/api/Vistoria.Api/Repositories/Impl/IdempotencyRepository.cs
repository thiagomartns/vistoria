using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Repositories.Impl;

public class IdempotencyRepository(AppDbContext db) : IIdempotencyRepository
{
    public async Task<bool> TryStartAsync(IdempotencyRecord record, CancellationToken cancellationToken)
    {
        db.IdempotencyRecords.Add(record);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException e) when (SqlErrors.IsUniqueViolation(e))
        {
            return false;
        }
        finally
        {
            // Gravada ou recusada, a linha sai do tracker: o SaveChanges do service não a toca.
            db.Entry(record).State = EntityState.Detached;
        }
    }

    public Task<IdempotencyRecord?> FindAsync(Guid userId, Guid key, CancellationToken cancellationToken) =>
        db.IdempotencyRecords.AsNoTracking()
            .SingleOrDefaultAsync(r => r.UserId == userId && r.Key == key, cancellationToken);

    public Task CompleteAsync(
        Guid userId, Guid key, int statusCode, string responseHeaders, byte[] responseBody,
        CancellationToken cancellationToken) =>
        Of(userId, key).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.State, IdempotencyState.Done)
            .SetProperty(r => r.StatusCode, statusCode)
            .SetProperty(r => r.ResponseHeaders, responseHeaders)
            .SetProperty(r => r.ResponseBody, responseBody), cancellationToken);

    public Task DeleteAsync(Guid userId, Guid key, CancellationToken cancellationToken) =>
        Of(userId, key).ExecuteDeleteAsync(cancellationToken);

    public Task DeleteIfExpiredAsync(
        Guid userId, Guid key, DateTimeOffset cutoff, CancellationToken cancellationToken) =>
        Of(userId, key).Where(r => r.CreatedAt < cutoff).ExecuteDeleteAsync(cancellationToken);

    public Task<int> DeleteAllExpiredAsync(DateTimeOffset cutoff, CancellationToken cancellationToken) =>
        db.IdempotencyRecords.Where(r => r.CreatedAt < cutoff).ExecuteDeleteAsync(cancellationToken);

    private IQueryable<IdempotencyRecord> Of(Guid userId, Guid key) =>
        db.IdempotencyRecords.Where(r => r.UserId == userId && r.Key == key);
}
