using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

public class IdempotencyRecordConfiguration : IEntityTypeConfiguration<IdempotencyRecord>
{
    public const int RequestHashLength = 32;

    public void Configure(EntityTypeBuilder<IdempotencyRecord> builder)
    {
        builder.ToTable("idempotency_keys");
        // A chave única do doc (UserId, Key): o INSERT que perde a corrida é recusado aqui.
        builder.HasKey(r => new { r.UserId, r.Key });
        builder.Property(r => r.RequestHash).HasMaxLength(RequestHashLength).IsFixedLength();
        builder.Property(r => r.State).HasConversion<string>().HasMaxLength(16);
        builder.Property(r => r.ResponseHeaders).HasMaxLength(2048);
        // O CleanupService apaga por idade.
        builder.HasIndex(r => r.CreatedAt);
    }
}
