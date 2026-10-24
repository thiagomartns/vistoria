using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model;

/// <summary>Item de um ambiente (vision.md, "Room e Item"). Sem versão própria: mudar um item sobe a da vistoria.</summary>
public class InspectionItem : AggregateChild
{
    public Guid RoomId { get; set; }
    public string Name { get; set; } = "";
    public int Position { get; set; } // ordem no ambiente
    public ItemCondition? Condition { get; set; }
    public string? Notes { get; set; }

    // Só em saída: copiados da entrada, somente leitura.
    public ItemCondition? ReferenceCondition { get; set; }
    public string? ReferenceNotes { get; set; }
}
