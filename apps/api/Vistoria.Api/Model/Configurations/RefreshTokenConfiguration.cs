using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

public class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public const int TokenHashLength = 32;

    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.ToTable("refresh_tokens");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();
        // O refresh acha o token pelo hash do cookie.
        builder.Property(t => t.TokenHash).HasMaxLength(TokenHashLength).IsFixedLength();
        builder.HasIndex(t => t.TokenHash).IsUnique();
        // Reuso revoga a família; o signout revoga pelo usuário.
        builder.HasIndex(t => t.FamilyId);
        builder.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
