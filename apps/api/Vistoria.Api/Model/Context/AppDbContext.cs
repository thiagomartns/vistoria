using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model.Context;

public class AppDbContext(DbContextOptions<AppDbContext> options, TimeProvider time) : DbContext(options)
{
    /// <summary>Nome do filtro global de soft delete; o de dono entra ao lado sem um apagar o outro.</summary>
    public const string SoftDeleteFilter = "SoftDelete";

    public DbSet<User> Users => Set<User>();
    public DbSet<Client> Clients => Set<Client>();
    public DbSet<Property> Properties => Set<Property>();
    public DbSet<Template> Templates => Set<Template>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    // Cada entidade traz seu IEntityTypeConfiguration em Model/Configurations/; o que é comum a toda SyncEntity
    // vem depois, para nenhum derivado ficar sem.
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        var configure = typeof(AppDbContext).GetMethod(nameof(ConfigureSyncEntity), BindingFlags.NonPublic | BindingFlags.Static)!;
        var syncTypes = modelBuilder.Model.GetEntityTypes()
            .Where(e => e.BaseType is null && e.ClrType.IsAssignableTo(typeof(SyncEntity)))
            .Select(e => e.ClrType)
            .ToList();
        foreach (var type in syncTypes)
        {
            configure.MakeGenericMethod(type).Invoke(null, [modelBuilder]);
        }
    }

    private static void ConfigureSyncEntity<T>(ModelBuilder modelBuilder) where T : SyncEntity
    {
        var entity = modelBuilder.Entity<T>();
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedNever();
        entity.Property(e => e.Version).IsRowVersion();
        entity.HasIndex(e => new { e.OwnerId, e.Version });
        entity.HasQueryFilter(SoftDeleteFilter, e => e.DeletedAt == null);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StampSyncEntities();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    // O código é async, mas um SaveChanges síncrono também não pode gravar data do cliente.
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StampSyncEntities();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    // Datas só do TimeProvider. Exclusão é sempre soft: Remove vira DeletedAt = now, e a linha muda de versão
    // para o delta devolver o tombstone. A limpeza física (CleanupService) usa ExecuteDelete, que não passa aqui.
    private void StampSyncEntities()
    {
        var now = time.GetUtcNow();
        foreach (var entry in ChangeTracker.Entries<SyncEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAt = now;
                    entry.Entity.UpdatedAt = now;
                    break;
                case EntityState.Deleted:
                    entry.State = EntityState.Modified;
                    entry.Entity.DeletedAt = now;
                    goto case EntityState.Modified;
                case EntityState.Modified:
                    var createdAt = entry.Property(e => e.CreatedAt);
                    createdAt.CurrentValue = createdAt.OriginalValue;
                    createdAt.IsModified = false;
                    entry.Entity.UpdatedAt = now;
                    break;
            }
        }
    }
}
