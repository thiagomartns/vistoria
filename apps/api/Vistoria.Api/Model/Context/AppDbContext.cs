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
    public DbSet<Inspection> Inspections => Set<Inspection>();
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<InspectionItem> InspectionItems => Set<InspectionItem>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    // Cada entidade traz seu IEntityTypeConfiguration em Model/Configurations/; o que é comum a toda SyncEntity (e a
    // todo filho de agregado) vem depois, para nenhum derivado ficar sem.
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        ConfigureAll<SyncEntity>(modelBuilder, nameof(ConfigureSyncEntity));
        ConfigureAll<AggregateChild>(modelBuilder, nameof(ConfigureAggregateChild));
    }

    private static void ConfigureAll<TBase>(ModelBuilder modelBuilder, string methodName)
    {
        var configure = typeof(AppDbContext).GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static)!;
        var types = modelBuilder.Model.GetEntityTypes()
            .Where(e => e.BaseType is null && e.ClrType.IsAssignableTo(typeof(TBase)))
            .Select(e => e.ClrType)
            .ToList();
        foreach (var type in types)
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

    // Sem versão, dono nem datas (ADR 0035): só a chave do cliente e o soft delete, que tira o filho do Include.
    private static void ConfigureAggregateChild<T>(ModelBuilder modelBuilder) where T : AggregateChild
    {
        var entity = modelBuilder.Entity<T>();
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id).ValueGeneratedNever();
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
        TouchAggregateRoots(now);
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

    // Regra do agregado (backend.md): ambiente e item não têm versão, então qualquer mudança neles marca a vistoria
    // Modified; o laço de StampSyncEntities carimba o UpdatedAt dela e o UPDATE sobe o rowversion. Remove de filho
    // vira DeletedAt = now, como na raiz. Sem a vistoria rastreada não há versão para subir: filho só se grava por ela.
    private void TouchAggregateRoots(DateTimeOffset now)
    {
        var changed = ChangeTracker.Entries<AggregateChild>()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .ToList();
        if (changed.Count == 0)
        {
            return;
        }

        var inspections = ChangeTracker.Entries<Inspection>().ToDictionary(e => e.Entity.Id);
        var rooms = ChangeTracker.Entries<Room>().ToDictionary(e => e.Entity.Id, e => e.Entity);
        foreach (var entry in changed)
        {
            if (entry.State == EntityState.Deleted)
            {
                entry.State = EntityState.Modified;
                entry.Entity.DeletedAt = now;
            }

            var inspectionId = entry.Entity switch
            {
                Room room => room.InspectionId,
                InspectionItem item when rooms.TryGetValue(item.RoomId, out var room) => room.InspectionId,
                _ => (Guid?)null,
            };
            if (inspectionId is not { } id || !inspections.TryGetValue(id, out var root))
            {
                throw new InvalidOperationException(
                    $"{entry.Entity.GetType().Name} {entry.Entity.Id} gravado sem a vistoria rastreada: ambientes e "
                    + "itens só são escritos pela raiz do agregado.");
            }

            if (root.State == EntityState.Unchanged)
            {
                root.State = EntityState.Modified;
            }
        }
    }
}
