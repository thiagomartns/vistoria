using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Vistoria.Api.Model.Configurations;

// Chave e soft delete vêm do AppDbContext, comuns a todo AggregateChild.
public class InspectionItemConfiguration : IEntityTypeConfiguration<InspectionItem>
{
    public const int NameMinLength = 1;
    public const int NameMaxLength = 60;
    public const int NotesMaxLength = 1000;
    public const int ConditionMaxLength = 20;

    public void Configure(EntityTypeBuilder<InspectionItem> builder)
    {
        builder.ToTable("inspection_items");
        builder.Property(i => i.Name).HasMaxLength(NameMaxLength);
        builder.Property(i => i.Condition).HasConversion<string>().HasMaxLength(ConditionMaxLength);
        builder.Property(i => i.Notes).HasMaxLength(NotesMaxLength);
        builder.Property(i => i.ReferenceCondition).HasConversion<string>().HasMaxLength(ConditionMaxLength);
        builder.Property(i => i.ReferenceNotes).HasMaxLength(NotesMaxLength);
    }
}
