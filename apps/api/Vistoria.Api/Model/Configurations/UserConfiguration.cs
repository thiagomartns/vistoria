using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public const int NameMaxLength = 120;
    public const int EmailMaxLength = 254;

    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Id).ValueGeneratedNever();
        builder.Property(u => u.Name).HasMaxLength(NameMaxLength);
        builder.Property(u => u.Email).HasMaxLength(EmailMaxLength);
        builder.HasIndex(u => u.Email).IsUnique();
        builder.Property(u => u.PasswordHash).HasMaxLength(256);
    }
}
