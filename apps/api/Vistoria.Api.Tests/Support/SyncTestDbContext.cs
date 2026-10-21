using Microsoft.EntityFrameworkCore;
using Vistoria.Api.Model.Base;
using Vistoria.Api.Model.Context;

namespace Vistoria.Api.Tests.Support;

/// <summary>Entidade só de teste: prova a base comum antes das entidades concretas do domínio.</summary>
public class SyncProbe : SyncEntity
{
    public string Name { get; set; } = "";
}

/// <summary>
/// O <see cref="AppDbContext"/> com a <see cref="SyncProbe"/>. Fica no projeto de testes, então não entra em
/// migração nem no <c>openapi.json</c>; o banco sai do <c>EnsureCreated</c> (<see cref="SyncDatabase"/>).
/// </summary>
public class SyncTestDbContext(DbContextOptions<AppDbContext> options, TimeProvider time) : AppDbContext(options, time)
{
    public DbSet<SyncProbe> Probes => Set<SyncProbe>();

    // A entidade entra antes do base, que aplica a configuração comum a toda SyncEntity do modelo.
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SyncProbe>(e =>
        {
            e.ToTable("sync_probes");
            e.Property(p => p.Name).HasMaxLength(100);
        });
        base.OnModelCreating(modelBuilder);
    }
}
