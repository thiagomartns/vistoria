using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave, versão, índice de dono e soft delete vêm do AppDbContext, comuns a toda SyncEntity.
public class ClientConfiguration : IEntityTypeConfiguration<Client>
{
    public const int NameMinLength = 2;
    public const int NameMaxLength = 120;
    public const int DocumentMaxLength = 14;
    public const int PhoneMaxLength = 20;

    public void Configure(EntityTypeBuilder<Client> builder)
    {
        builder.ToTable("clients");
        builder.Property(c => c.Name).HasMaxLength(NameMaxLength);
        builder.Property(c => c.Document).HasMaxLength(DocumentMaxLength);
        builder.Property(c => c.Email).HasMaxLength(UserConfiguration.EmailMaxLength);
        builder.Property(c => c.Phone).HasMaxLength(PhoneMaxLength);
    }
}
