using Vistoria.Api.Model.Base;

namespace Vistoria.Api.Model;

/// <summary>Ambiente da vistoria (vision.md, "Room e Item"). Sem versão própria: mudar um ambiente sobe a da vistoria.</summary>
public class Room : AggregateChild
{
    public Guid InspectionId { get; set; }
    public string Name { get; set; } = "";
    public int Position { get; set; } // ordem na vistoria
    public string? Notes { get; set; }
    public List<InspectionItem> Items { get; set; } = [];
}
