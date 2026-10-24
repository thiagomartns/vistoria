using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave e soft delete vêm do AppDbContext, comuns a todo AggregateChild.
public class RoomConfiguration : IEntityTypeConfiguration<Room>
{
    public const int NameMinLength = 1;
    public const int NameMaxLength = 60;
    public const int NotesMaxLength = 1000;
    public const int ItemsMax = 60;

    public void Configure(EntityTypeBuilder<Room> builder)
    {
        builder.ToTable("rooms");
        builder.Property(r => r.Name).HasMaxLength(NameMaxLength);
        builder.Property(r => r.Notes).HasMaxLength(NotesMaxLength);
        builder.HasMany(r => r.Items).WithOne().HasForeignKey(i => i.RoomId).OnDelete(DeleteBehavior.Cascade);
    }
}
